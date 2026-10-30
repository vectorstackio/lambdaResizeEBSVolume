import { test, vi } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { handler } from '../src/handler.ts'

const mocks = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('@aws-sdk/client-ec2', () => ({
  EC2Client: class { send = mocks.send },
  ModifyVolumeCommand: class { constructor(input) { this.input = input } }
}))
const source = fs.readFileSync(path.resolve('src/handler.ts'), 'utf8')
const marker = 'SENSITIVE_TEST_VALUE_DO_NOT_LOG'
const allowed = new Set([
  'Resize request rejected: invalid JSON object',
  'Validation failed: volumeId is missing', 'Validation failed: size is missing',
  'Validation failed: invalid size', 'Calling ModifyVolume',
  'ModifyVolume succeeded', 'ModifyVolume failed'
])
function fixture(send) {
  const logs = []
  mocks.send.mockReset().mockImplementation(command => send(command.input))
  for (const level of ['log', 'error', 'warn', 'info', 'debug', 'trace', 'dir', 'table']) {
    vi.spyOn(console, level).mockImplementation((...args) => logs.push(args))
  }
  return { handler, logs, get requests() { return mocks.send.mock.calls.map(call => call[0].input) } }
}
function checkLogs(logs) {
  for (const args of logs) {
    assert.equal(args.length, 1)
    assert.equal(typeof args[0], 'string')
    assert.ok(allowed.has(args[0]))
    assert.ok(!args[0].includes(marker))
  }
}
function event(body) {
  return {
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { authorization: marker, cookie: marker, 'x-amz-security-token': marker },
    requestContext: { authorizer: { credentials: marker } },
    extra: marker
  }
}
const valid = { volumeId: 'vol-0123456789abcdef0', instanceId: 'i-0123456789abcdef0', size: 32, credentials: marker, nested: { token: marker } }

test('success logs only allowlisted messages; request and service data never reach logs', async () => {
  const result = { VolumeModification: { VolumeId: 'vol-0123456789abcdef0', OriginalSize: 16, TargetSize: 32, ModificationState: 'modifying', ignored: marker } }
  const f = fixture(async () => result)
  const response = await f.handler(event(valid))
  assert.equal(response.statusCode, 200)
  assert.equal(f.requests.length, 1)
  assert.deepEqual(JSON.parse(response.body), { volumeId: valid.volumeId, originalSize: 16, targetSize: 32, state: 'modifying' })
  assert.ok(f.logs.length > 0)
  checkLogs(f.logs)
})

test('SDK errors with sensitive messages, metadata, headers and throwing getters are not logged or serialized', async () => {
  for (const error of [Object.assign(new Error(marker), { authorization: marker, $metadata: { headers: { authorization: marker } } }), new Proxy({}, { get() { throw new Error(marker) } })]) {
    const f = fixture(async () => { throw error })
    const response = await f.handler(event(valid))
    assert.equal(response.statusCode, 500)
    assert.ok(!response.body.includes(marker))
    checkLogs(f.logs)
  }
})

test('malformed JSON cannot leak through parser exceptions or reach AWS', async () => {
  for (const body of ['{"secret":"' + marker + '", invalid}', 'null', '[]', '"' + marker + '"']) {
    const f = fixture(async () => { throw new Error('Unexpected AWS call') })
    const response = await f.handler(event(body))
    assert.equal(response.statusCode, 400)
    assert.ok(!response.body.includes(marker))
    assert.equal(f.requests.length, 0)
    checkLogs(f.logs)
  }
})

test('validation paths never log arbitrary request fields', async () => {
  const cases = [
    { size: 32, secret: marker }, { volumeId: marker },
    { volumeId: marker, size: marker }, { volumeId: marker, size: { secret: marker } },
    { volumeId: marker, size: -1 }
  ]
  for (const body of cases) {
    const f = fixture(async () => { throw new Error('Unexpected AWS call') })
    const response = await f.handler(event(body))
    assert.equal(response.statusCode, 400)
    assert.equal(f.requests.length, 0)
    checkLogs(f.logs)
  }
})

test('every direct console call has exactly one allowlisted literal argument, including multiline statements', () => {
  const ast = ts.createSourceFile('handler.ts', source, ts.ScriptTarget.Latest, true)
  assert.equal(ast.parseDiagnostics.length, 0)
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(ast) === 'console') {
      assert.equal(node.arguments.length, 1)
      assert.ok(ts.isStringLiteral(node.arguments[0]))
      assert.ok(allowed.has(node.arguments[0].text))
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
})

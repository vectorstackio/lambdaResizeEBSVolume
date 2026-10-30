import { test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { handler } from '../src/handler.ts'

const mocks = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('@aws-sdk/client-ec2', () => ({
  EC2Client: class { send = mocks.send },
  ModifyVolumeCommand: class { constructor(input) { this.input = input } }
}))

function fixture(send = async () => ({})) {
  mocks.send.mockReset().mockImplementation(send)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  return { handler, get requests() { return mocks.send.mock.calls.map(call => call[0]) } }
}

function event(body) { return { body: JSON.stringify(body) } }
function response(result) { return { statusCode: result.statusCode, body: JSON.parse(result.body) } }

test('sends the requested volume and size and returns the modification details', async () => {
  const f = fixture(async () => ({ VolumeModification: { VolumeId: 'vol-result', OriginalSize: 8, TargetSize: 32, ModificationState: 'modifying' } }))
  const result = await f.handler(event({ volumeId: 'vol-request', size: 32, ignored: 'value' }))
  assert.deepEqual(response(result), { statusCode: 200, body: { volumeId: 'vol-result', originalSize: 8, targetSize: 32, state: 'modifying' } })
  assert.equal(f.requests.length, 1)
  assert.equal(f.requests[0].constructor.name, 'ModifyVolumeCommand')
  assert.deepEqual(f.requests[0].input, { VolumeId: 'vol-request', Size: 32 })
})

test('accepts the smallest positive integer size', async () => {
  const f = fixture()
  assert.equal((await f.handler(event({ volumeId: 'vol-1', size: 1 }))).statusCode, 200)
  assert.equal(f.requests[0].input.Size, 1)
})

test('handles absent or partial modification data in a successful response', async () => {
  for (const awsResult of [{}, { VolumeModification: null }, { VolumeModification: { VolumeId: 'vol-1', TargetSize: 10 } }]) {
    const f = fixture(async () => awsResult)
    const result = response(await f.handler(event({ volumeId: 'vol-1', size: 10 })))
    assert.equal(result.statusCode, 200)
    assert.deepEqual(result.body, awsResult.VolumeModification ? { volumeId: 'vol-1', targetSize: 10 } : {})
  }
})

for (const [description, body] of [
  ['malformed JSON', '{'], ['empty body', ''], ['null', 'null'], ['array', '[]'],
  ['string', '"text"'], ['number', '42'], ['boolean', 'true'], ['missing body', undefined]
]) {
  test(`rejects ${description} without calling EC2`, async () => {
    const f = fixture()
    assert.deepEqual(response(await f.handler({ body })), { statusCode: 400, body: { error: 'Request body must be a JSON object' } })
    assert.equal(f.requests.length, 0)
  })
}

for (const [description, body, error] of [
  ['missing volumeId', { size: 1 }, 'volumeId is required'],
  ['empty volumeId', { volumeId: '', size: 1 }, 'volumeId is required'],
  ['null volumeId', { volumeId: null, size: 1 }, 'volumeId is required'],
  ['both required fields missing', {}, 'volumeId is required'],
  ['missing size', { volumeId: 'vol-1' }, 'size is required'],
  ['zero size', { volumeId: 'vol-1', size: 0 }, 'size is required'],
  ['null size', { volumeId: 'vol-1', size: null }, 'size is required'],
  ['string size', { volumeId: 'vol-1', size: '10' }, 'size must be a positive integer'],
  ['negative size', { volumeId: 'vol-1', size: -1 }, 'size must be a positive integer'],
  ['fractional size', { volumeId: 'vol-1', size: 1.5 }, 'size must be a positive integer'],
  ['object size', { volumeId: 'vol-1', size: {} }, 'size must be a positive integer'],
  ['boolean size', { volumeId: 'vol-1', size: true }, 'size must be a positive integer']
]) {
  test(`rejects ${description} without calling EC2`, async () => {
    const f = fixture()
    assert.deepEqual(response(await f.handler(event(body))), { statusCode: 400, body: { error } })
    assert.equal(f.requests.length, 0)
  })
}

test('returns a generic server error if EC2 rejects the request', async () => {
  const f = fixture(async () => { throw new Error('private AWS details') })
  assert.deepEqual(response(await f.handler(event({ volumeId: 'vol-1', size: 10 }))), { statusCode: 500, body: { error: 'Internal server error in resizeEBSVolume' } })
  assert.equal(f.requests.length, 1)
})

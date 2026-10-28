// handler.ts

import { EC2Client, ModifyVolumeCommand } from '@aws-sdk/client-ec2'

type Event = {
  body: string
}

const client = new EC2Client({})

export async function handler(event: Event) {
  // Never log request data or parser errors: they can contain credentials.
  let body
  try {
    body = JSON.parse(event.body)
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('Invalid body')
    }
  } catch {
    console.error('Resize request rejected: invalid JSON object')
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Request body must be a JSON object' })
    }
  }

  const { volumeId, size } = body

  if (!volumeId) {
    console.error('Validation failed: volumeId is missing')

    return {
      statusCode: 400,
      body: JSON.stringify({
        error: 'volumeId is required'
      })
    }
  }

  if (!size) {
    console.error('Validation failed: size is missing')

    return {
      statusCode: 400,
      body: JSON.stringify({
        error: 'size is required'
      })
    }
  }

  if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0) {
    console.error('Validation failed: invalid size')

    return {
      statusCode: 400,
      body: JSON.stringify({error:'size must be a positive integer'})
    }
  }

  console.log('Calling ModifyVolume')

  try {

    const result =
      await client.send(
        new ModifyVolumeCommand({
          VolumeId: volumeId,
          Size: size
        })
      )

    console.log('ModifyVolume succeeded')

    return {
      statusCode: 200,
      body: JSON.stringify({
        volumeId: result.VolumeModification?.VolumeId,
        originalSize: result.VolumeModification?.OriginalSize,
        targetSize: result.VolumeModification?.TargetSize,
        state: result.VolumeModification?.ModificationState
      })
    }
  } catch {
    console.error('ModifyVolume failed')

    return {
      statusCode: 500,
      body: JSON.stringify({error: 'Internal server error in resizeEBSVolume'})
    }

  }
}
// handler.ts

import { EC2Client, ModifyVolumeCommand } from '@aws-sdk/client-ec2'

type Event = {
  body: string
}

const client = new EC2Client({})

export async function handler(event: Event) {
  console.log('Received event:', JSON.stringify(event))

  const body = JSON.parse(event.body)

  console.log('Parsed body:', JSON.stringify(body))

  const { volumeId, size } = body

  console.log('Resize request:',
    JSON.stringify({
      volumeId,
      size,
      sizeType: typeof size
    })
  )

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
    console.error(
      'Validation failed: invalid size:',
      JSON.stringify({
        size,
        type: typeof size
      })
    )

    return {
      statusCode: 400,
      body: JSON.stringify({error:'size must be a positive integer'})
    }
  }

  console.log(
    'Calling ModifyVolume:',
    JSON.stringify({
      VolumeId: volumeId,
      Size: size
    })
  )

  try {

    const result =
      await client.send(
        new ModifyVolumeCommand({
          VolumeId: volumeId,
          Size: size
        })
      )

    console.log(
      'ModifyVolume result:',
      JSON.stringify(result.VolumeModification)
    )

    return {
      statusCode: 200,
      body: JSON.stringify({
        volumeId: result.VolumeModification?.VolumeId,
        originalSize: result.VolumeModification?.OriginalSize,
        targetSize: result.VolumeModification?.TargetSize,
        state: result.VolumeModification?.ModificationState
      })
    }
  } catch (err) {
    console.error('ModifyVolume failed:', err)

    return {
      statusCode: 500,
      body: JSON.stringify({error: 'Internal server error in resizeEBSVolume'})
    }

  }
}
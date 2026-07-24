// handler.ts

import {
  EC2Client,
  ModifyVolumeCommand
} from '@aws-sdk/client-ec2'

type Event = {
  body: string
}

const client = new EC2Client({})

export async function handler(event: Event) {

  const body = JSON.parse(event.body)

  const {
    volumeId,
    size
  } = body

  if (!volumeId) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: 'volumeId is required'
      })
    }
  }

  if (!size) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: 'size is required'
      })
    }
  }

  if (
    typeof size !== 'number' ||
    !Number.isInteger(size) ||
    size <= 0
  ) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: 'size must be a positive integer'
      })
    }
  }

  const result = await client.send(
    new ModifyVolumeCommand({
      VolumeId: volumeId,
      Size: size
    })
  )

  return {
    statusCode: 200,
    body: JSON.stringify({
      volumeId: result.VolumeModification?.VolumeId,
      originalSize:
        result.VolumeModification?.OriginalSize,
      targetSize:
        result.VolumeModification?.TargetSize,
      state:
        result.VolumeModification?.ModificationState
    })
  }
}
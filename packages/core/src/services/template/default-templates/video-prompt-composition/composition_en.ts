import type { Template } from '../../types'

export const template: Template = {
  id: 'video-prompt-from-reference',
  name: 'Replicate a reference video',
  content: `Watch the entire reference video and write a self-contained video-generation prompt in English. Open with the subject, its setting and its position in the frame. Include distinctive features and the framing, light, color or visual style that matters to the recreation.

Follow the main action from its starting state through each visible change to the way it ends. Use concrete verbs. Make clear whether the subject, the surroundings or the camera moves. Give direction, pace, pauses or interactions when evident. If the camera is locked or the scene is still, say so. Keep a continuous shot together. When there is a cut, describe what is visible on either side. Use timestamps only when the timing is discernible and helps recreate the sequence.

Describe people through visible gestures and expressions. Leave out guesses about identity, motives or thoughts. Preserve important, legible on-screen wording in its original language. Include sound or quote speech only when you can actually hear it and it matters to the recreation.

Return one JSON object of the form {"prompt":"prompt text"}. Begin the prompt value directly with the scene or action. Omit introductions, headings and explanations. Do not add text or Markdown around the object.`,
  metadata: {
    version: '1.0.0',
    lastModified: 1795824000000,
    templateType: 'video-prompt-composition',
    language: 'en',
    internalOnly: true,
  },
  isBuiltin: true,
}

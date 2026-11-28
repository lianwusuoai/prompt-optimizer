import { describe, expect, it } from 'vitest'
import { extractVideoPrompt } from '../../../src/services/video-prompt-from-reference'

describe('extractVideoPrompt', () => {
  const zhIntro = '这是一段根据视频内容生成的提示词：'
  const zhBrief = '一位年轻美丽的亚洲女性，留着齐刘海的棕色短发，身穿粉色针织开衫内搭白色上衣。她站在户外的街道背景前，面带微笑地直视镜头说话。视频中她的表情生动自然，嘴唇不断开合，像是在进行对话或表达观点。在00:07时，她开心地大笑起来，眼睛眯成一条缝，露出洁白的牙齿，随后笑容逐渐收敛，恢复为温和的微笑。画面光线明亮柔和，阳光洒在她的头发和脸上，背景略微虚化以突出主体。整个过程中镜头保持静止的特写构图，没有任何转场，真实地记录了她的面部表情变化。'

  it.each([
    [zhIntro, zhBrief],
    ['Here’s the prompt based on the video:', 'In a fixed close-up, a woman smiles at the camera.'],
  ])('removes the standalone heading %s', (heading, body) => {
    const reply = heading + '\r\n\r\n' + body
    expect(extractVideoPrompt(reply)).toBe(body)
    expect(extractVideoPrompt(JSON.stringify({ prompt: reply }))).toBe(body)
  })

  it('reads the prompt from a fenced object surrounded by commentary', () => {
    const reply = ['My result follows.', '```json', JSON.stringify({ prompt: zhBrief }), '```', 'End of response.'].join('\n')
    expect(extractVideoPrompt(reply)).toBe(zhBrief)
  })

  it.each([
    '镜头一：\n屏幕上写着「这是一段根据视频内容生成的提示词：」。',
    '[00:07] A close-up of a sign reading “Here is the prompt:” before the cut.',
    'A monitor displays the literal text ```json```.',
  ])('preserves shot headings and on-screen text', body => {
    expect(extractVideoPrompt(body)).toBe(body)
    expect(extractVideoPrompt(JSON.stringify({ prompt: body }))).toBe(body)
  })

  it.each(['', zhIntro, '[]', '{"summary":"no prompt"}', '{"prompt":{}}', '{"prompt":" "}', '{"prompt":'])(
    'returns no brief for an empty or malformed result', value => {
      expect(extractVideoPrompt(value)).toBe('')
    },
  )
})

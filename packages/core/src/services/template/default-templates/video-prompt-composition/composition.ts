import type { Template } from '../../types'

// References for both locales. Cosmos describes the video-to-caption task,
// while Runway and Wan describe the text their video generators take as input.
// https://github.com/NVIDIA/cosmos-framework/blob/main/cosmos_framework/inference/defaults/video_captioner.txt
// https://help.runwayml.com/hc/en-us/articles/42460036199443-Text-to-Video-Prompting-Guide
// https://help.aliyun.com/zh/model-studio/text-to-video-prompt

export const template: Template = {
  id: 'video-prompt-from-reference',
  name: '根据参考视频复刻视频',
  content: `观察整段参考视频，写一段无需参考原片也能直接用于生成视频的中文提示词。从开场画面写起，交代主体的辨识特征、所在环境和画面中的位置。保留对复刻有用的景别、光线、色彩或画面风格。

按发生顺序，用具体动词写出关键动作从什么状态开始、如何变化、最后是什么状态。分清主体或环境在动，还是镜头在动。方向、快慢、停顿和互动明显时才写。固定机位和静止画面可以照实描述。连续镜头连贯地写，确有切镜时才分镜描述切换前后的画面。只有能确认且有助于复刻时才写时间点。

用可见的姿态和表情描写人物，省去对身份、动机或想法的猜测。重要且清晰的画面文字保留原文。只有确实听清且与复刻有关时才写声音或引用台词。

返回一个 JSON 对象，格式为 {"prompt":"提示词正文"}。prompt 的值直接从场景或动作写起，省去介绍语、标题和解释。对象外不要添加文字或 Markdown 标记。`,
  metadata: {
    version: '1.0.0',
    lastModified: 1795824000000,
    templateType: 'video-prompt-composition',
    language: 'zh',
    internalOnly: true,
  },
  isBuiltin: true,
}

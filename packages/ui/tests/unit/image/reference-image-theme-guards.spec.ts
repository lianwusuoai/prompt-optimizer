import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const readWorkspaceSource = () =>
  readFileSync(
    resolve(process.cwd(), 'src/components/image-mode/ImageText2ImageWorkspace.vue'),
    'utf8',
  )

describe('reference image workspace theme guards', () => {
  it('shares the themed entry button with video and applies the result from the image picker', () => {
    const source = readWorkspaceSource()
    const sharedButton = readFileSync(resolve(process.cwd(), 'src/components/media/ReferenceActionButton.vue'), 'utf8')
    const video = readFileSync(resolve(process.cwd(), 'src/components/video-mode/VideoReverseAction.vue'), 'utf8')

    expect(source).toMatch(/referenceActionButtons/)
    expect(source).toContain('<ReferenceActionButton')
    expect(video).toContain('<ReferenceActionButton')
    expect(sharedButton).toContain('<ThemedTooltip')
    expect(source).toContain('<ImageReferenceDialog')
    expect(source).toContain('@apply="applyReferenceResult"')
    expect(source).toMatch(/reference-action-\$\{button\.kind\}-button/)
    expect(source).toMatch(/triggerReferenceAction\(button\.kind\)/)
    expect(source).toMatch(/imageWorkspace\.referenceImage\.replicateAction/)
    expect(source).toMatch(/imageWorkspace\.referenceImage\.styleLearnAction/)
    expect(source).toMatch(/imageWorkspace\.referenceImage\.styleLearnDisabledHint/)
    expect(source).toMatch(/reference-action-thumbnail/)
    expect(source).toMatch(/reference-action-status/)
    expect(source).toMatch(/referenceAction\.status/)
    expect(source).toMatch(/referenceAction\.canTriggerStyleLearning/)
    expect(source).toMatch(/referenceAction\.sourceImagePreviewUrl/)
    expect(source).toMatch(/referenceAction\.applyToCurrentPrompt\(\)/)
    expect(source).toMatch(/setResultPreview/)
    expect(source).not.toMatch(/<NModal/)
    expect(source).not.toMatch(/<NPopover/)
    expect(source).not.toMatch(/image-text2image-extract-button/)
    expect(source).not.toMatch(/detectedCurrentPromptTitle/)
    expect(source).not.toMatch(/handleReferenceActionApply/)
    expect(source).not.toMatch(/handleReferenceActionPopoverShowChange/)
    expect(source).not.toMatch(/reference-action-popover/)
    expect(source).not.toMatch(/data-testid="reference-action-status-button"/)
  })

  it('clears asset binding explicitly when applying extracted prompt artifacts', () => {
    const source = readWorkspaceSource()

    expect(source).toMatch(
      /const resetExtractedPromptArtifacts = \(\) => \{[\s\S]*session\.clearAssetBinding\(\)[\s\S]*session\.updateOptimizedResult/,
    )
  })
})

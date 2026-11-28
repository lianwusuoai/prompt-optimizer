import { describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import type { TextModelConfig } from '@prompt-optimizer/core'
import TextModelList from '../../../src/components/TextModelList.vue'

const layout = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('../../../src/composables/ui/useWorkspaceLayout', () => ({ useWorkspaceLayout: () => ({ isCompact: layout.current }) }))

const Row = defineComponent({
  props: ['title', 'subtitle', 'menuOptions', 'testing', 'enabled'], emits: ['edit', 'test', 'action'],
  template: '<div class="mobile-row"><button class="edit" @click="$emit(\'edit\')">{{ title }}</button><button class="test" @click="$emit(\'test\')">Test</button></div>',
})
const Input = defineComponent({ props: ['value'], emits: ['update:value'], template: '<input :value="value" @input="$emit(\'update:value\', $event.target.value)" />' })
const models = [
  { id: 'builtin', name: 'Built-in', enabled: true, providerMeta: { id: 'openai', name: 'OpenAI' }, modelMeta: { id: 'model-b', name: 'Model B' } },
  { id: 'custom', name: 'My mobile model', enabled: false, providerMeta: { id: 'custom-provider', name: 'Team endpoint' }, modelMeta: { id: 'team-model-c', name: 'Model C' } },
] as TextModelConfig[]

function renderList(items = models) {
  const compact = ref(true)
  layout.current = compact
  const wrapper = mount(TextModelList, {
    props: { models: items, isTestingConnectionFor: () => false },
    global: { stubs: { MobileModelRow: Row, NInput: Input, NEmpty: true } },
  })
  return { wrapper, compact }
}

describe('mobile text model list', () => {
  it('finds models by name, provider and model ID, retaining the query across layout changes', async () => {
    const { wrapper, compact } = renderList()
    for (const query of ['mobile', 'Team endpoint', 'team-model-c']) {
      await wrapper.get('[data-testid="text-model-search"] input').setValue(query)
      expect(wrapper.findAllComponents(Row).map(row => row.props('title'))).toEqual(['My mobile model'])
    }
    compact.value = false
    await nextTick()
    expect(wrapper.findAll('.model-config-card')).toHaveLength(2)
    compact.value = true
    await nextTick()
    expect(wrapper.findAllComponents(Row)).toHaveLength(1)
    expect(wrapper.get('[data-testid="text-model-search"] input').element).toHaveProperty('value', 'team-model-c')
    wrapper.unmount()
  })

  it('keeps shared edit/test actions and reserves account removal for subscription settings', async () => {
    const { wrapper } = renderList([...models, { ...models[0], id: 'subscription', providerId: 'chatgpt-subscription' }])
    const [builtin, custom, subscription] = wrapper.findAllComponents(Row)
    expect(builtin.props('menuOptions').map((option: { key: string }) => option.key)).toEqual(['clone', 'disable', 'delete'])
    expect(custom.props('menuOptions').map((option: { key: string }) => option.key)).toEqual(['clone', 'enable', 'delete'])
    expect(subscription.props('menuOptions').map((option: { key: string }) => option.key)).toEqual(['disable'])
    await custom.get('.edit').trigger('click')
    await custom.get('.test').trigger('click')
    expect(wrapper.emitted('edit')).toEqual([['custom']])
    expect(wrapper.emitted('test')).toEqual([['custom']])
    subscription.vm.$emit('action', 'delete')
    subscription.vm.$emit('action', 'clone')
    expect(wrapper.emitted('delete')).toBeUndefined()
    expect(wrapper.emitted('clone')).toBeUndefined()
    custom.vm.$emit('action', 'delete')
    expect(wrapper.emitted('delete')).toEqual([['custom']])
    wrapper.unmount()
  })
})

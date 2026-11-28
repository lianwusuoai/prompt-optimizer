import { afterEach, expect, it, vi } from 'vitest'
import { NDropdown } from 'naive-ui'
import { flushPromises, mount } from '@vue/test-utils'
import ChatGPTSubscriptionConnection from '../../../src/components/ChatGPTSubscriptionConnection.vue'
import type { ChatGPTSubscriptionStatus } from '../../../src/types/electron'

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = '' })

it('only shows the subscription when the desktop bridge exists', () => {
  const wrapper = mount(ChatGPTSubscriptionConnection, { props: { active: true } })
  expect(wrapper.find('[data-testid="chatgpt-subscription"]').exists()).toBe(false)
  wrapper.unmount()
})

it('keeps the signed-in account visible when the synchronized catalog has no text models', async () => {
  vi.stubGlobal('electronAPI', { chatgptSubscription: { status: async () => ({
    status: 'connected', email: 'empty@example.test', count: 0, synced: true, welcomed: true, persistent: true,
  }) } })
  const wrapper = mount(ChatGPTSubscriptionConnection, { props: { active: true } })
  try {
    await flushPromises()
    expect(wrapper.findAll('[data-testid="chatgpt-subscription"]')).toHaveLength(1)
    expect(wrapper.text()).toContain('empty@example.test')
    expect(wrapper.text()).toContain('No text models available')
    expect(wrapper.emitted('availability')?.at(-1)).toEqual([true])
  } finally { wrapper.unmount() }
})

it('connects from settings, reports catalog results and refreshes the workspace after a disconnect', async () => {
  let status: ChatGPTSubscriptionStatus = { status: 'disconnected', email: '', synced: false, count: 0, persistent: true, welcomed: true }
  const bridge = { status: vi.fn(async () => status),
    connect: vi.fn(async () => status = { ...status, status: 'connected', email: 'subscriber@example.test', synced: true, count: 2 }),
    refresh: vi.fn(async () => { throw new Error('chatgptSubscription.catalogFailed') }),
    disconnect: vi.fn(async () => status = { ...status, status: 'signedOut', synced: false, count: 0 }),
    manageUsage: vi.fn(), acknowledge: vi.fn(), cancel: vi.fn() }
  vi.stubGlobal('electronAPI', { chatgptSubscription: bridge })
  const wrapper = mount(ChatGPTSubscriptionConnection, { props: { active: true }, global: { stubs: {
    NModal: { props: ['show'], template: '<section v-if="show"><slot /></section>' },
  } } })
  try {
    await flushPromises()
    const click = async (label: string) => {
      const button = wrapper.findAll('button').find(button => button.text() === label)
      expect(button, label).toBeDefined()
      await button!.trigger('click')
      await flushPromises()
    }
    expect(wrapper.find('[data-testid="chatgpt-subscription"]').exists()).toBe(false)
    wrapper.vm.open()
    await flushPromises()
    await click('Continue with ChatGPT')
    expect(wrapper.text()).toContain('2 text models')
    expect(wrapper.text()).toContain('subscriber@example.test')
    await click('Refresh models')
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not refresh')
    expect(wrapper.text()).toContain('2 text models')
    const menu = wrapper.getComponent(NDropdown)
    expect(menu.props('options')?.map(item => item.key)).toEqual(['switch', 'manageUsage', 'disconnect'])
    menu.vm.$emit('select', 'manageUsage')
    await flushPromises()
    expect(bridge.manageUsage).toHaveBeenCalledOnce()
    menu.vm.$emit('select', 'disconnect')
    await flushPromises()
    expect(wrapper.emitted('updated')).toHaveLength(3)
    expect(wrapper.find('[data-testid="chatgpt-subscription"]').exists()).toBe(false)
    expect(wrapper.emitted('availability')?.at(-1)).toEqual([false])
  } finally { wrapper.unmount() }
});

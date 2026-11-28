<template>
  <template v-if="bridge">
    <div v-if="account && !hasConnection" ref="accountRow" class="subscription-row" tabindex="-1">
      <ChatGPTSubscriptionAccount v-bind="account" @action="onAccountAction" />
    </div>

    <NModal v-model:show="authOpen" preset="card" :title="t('chatgptSubscription.title')" class="subscription-dialog"
      :style="{ width: 'min(92vw, 400px)' }" @after-leave="cancelPending">
      <NSpace vertical :size="12">
        <NText>{{ t(needsConsent ? 'chatgptSubscription.permissionRequired' : 'chatgptSubscription.description') }}</NText>
        <NText v-if="busy === 'connect'" role="status">{{ t('chatgptSubscription.waiting') }}</NText>
        <NText v-if="notice" role="alert">{{ t(notice) }}</NText>
        <NButton v-if="busy === 'connect'" @click="bridge.cancel()">{{ t('common.cancel') }}</NButton>
        <NButton v-else color="#171717" data-oai-siwc-button :disabled="!!busy" @click="run('connect', switchAccount)">
          <template #icon><img :src="chatgptLogo" width="16" height="16" alt="" /></template>
          {{ t('chatgptSubscription.continue') }}
        </NButton>
        <NButton v-if="state?.revocationUnconfirmed" text @click="run('manageUsage')">{{ t('chatgptSubscription.usage') }}</NButton>
      </NSpace>
    </NModal>
    <NModal :show="active && !authOpen && state?.status === 'connected' && !state.welcomed" preset="dialog"
      :title="t('chatgptSubscription.usingPlan')" :content="t('chatgptSubscription.welcome')"
      :show-icon="false" :closable="false" :mask-closable="false" :close-on-esc="false"
      :positive-text="t('common.confirm')" @positive-click="run('acknowledge')" />
  </template>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { NButton, NModal, NSpace, NText } from 'naive-ui'
import ChatGPTSubscriptionAccount, { type SubscriptionAccountAction } from './ChatGPTSubscriptionAccount.vue'
import chatgptLogo from '../assets/chatgpt-logo-white.svg'
import { useI18n } from 'vue-i18n'
import type { ChatGPTSubscriptionStatus } from '../types/electron'

const props = defineProps<{ active: boolean; hasConnection?: boolean }>()
const emit = defineEmits<{ updated: []; availability: [hasAccount: boolean] }>()
const { t } = useI18n()
const bridge = window.electronAPI?.chatgptSubscription
const state = ref<ChatGPTSubscriptionStatus>()
const busy = ref('')
const notice = ref('')
const authOpen = ref(false)
const switchAccount = ref(false)
const accountRow = ref<HTMLElement>()
const hasAccount = computed(() => state.value?.status === 'connected' || state.value?.status === 'needsConsent')
const account = computed(() => hasAccount.value && state.value
  ? { state: state.value, busy: busy.value, notice: authOpen.value ? '' : notice.value }
  : undefined)
const needsConsent = computed(() => state.value?.status === 'needsConsent' || notice.value === 'chatgptSubscription.reconnect')
async function updateStatus() {
  if (bridge) state.value = await bridge.status()
}
watch([state, hasAccount], () => { if (state.value) emit('availability', hasAccount.value) })
watch(() => props.active, active => {
  if (!active) authOpen.value = false
  else if (!busy.value) void updateStatus().catch(() => {
    notice.value = 'chatgptSubscription.authorizationFailed'
    emit('availability', false)
  })
}, { immediate: true })

function open() {
  switchAccount.value = false
  if (hasAccount.value && !needsConsent.value) {
    void nextTick(() => accountRow.value?.focus())
  } else {
    authOpen.value = true
  }
}
defineExpose({ open, account, onAccountAction })
function onAccountAction(action: SubscriptionAccountAction) {
  if (action === 'switch' || action === 'authorize') {
    switchAccount.value = action === 'switch'
    authOpen.value = true
  } else void run(action)
}
function cancelPending() {
  if (!authOpen.value && busy.value === 'connect') bridge?.cancel()
}

async function run(action: 'connect' | 'refresh' | 'disconnect' | 'acknowledge' | 'manageUsage', newAccount = false) {
  if (!bridge || busy.value) return
  busy.value = action
  notice.value = ''
  try {
    if (action === 'manageUsage') { await bridge.manageUsage(); return }
    state.value = action === 'connect' ? await bridge.connect(newAccount) : await bridge[action]()
    if (state.value.revocationUnconfirmed) {
      notice.value = 'chatgptSubscription.revocationUnconfirmed'
      authOpen.value = true
    }
  } catch (error) {
    const failure = error as { code?: string; message?: string }
    notice.value = [failure.code, failure.message].find(value => value?.startsWith('chatgptSubscription.')) || 'chatgptSubscription.authorizationFailed'
    await updateStatus().catch(() => {})
  } finally {
    busy.value = ''
    if (action === 'connect' && state.value?.status === 'connected') authOpen.value = false
    if (['refresh', 'disconnect', 'connect'].includes(action)) emit('updated')
  }
}
</script>

<style scoped>
.subscription-row { padding: 12px 14px; margin-bottom: 12px; border: 1px solid var(--n-border-color); border-radius: var(--n-border-radius, 6px); }
</style>

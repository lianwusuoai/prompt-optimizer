<template>
  <section class="subscription-account" data-testid="chatgpt-subscription">
    <span class="subscription-logo"><img :src="chatgptLogo" width="19" height="19" alt="" /></span>
    <div class="subscription-identity">
      <NText strong>{{ t('chatgptSubscription.title') }}</NText>
      <NText depth="3">{{ [state.email, catalogLabel].filter(Boolean).join(' · ') }}</NText>
    </div>
    <NButton v-if="needsConsent" size="small" :disabled="!!busy" @click="emit('action', 'authorize')">
      {{ t('chatgptSubscription.reauthorize') }}
    </NButton>
    <NButton v-else size="small" quaternary :disabled="!!busy" :loading="busy === 'refresh'" @click="emit('action', 'refresh')">
      {{ t('chatgptSubscription.refresh') }}
    </NButton>
    <NDropdown trigger="click" :options="accountActions" @select="emit('action', $event)">
      <NButton size="small" circle quaternary :disabled="!!busy" :aria-label="t('modelManager.provider.more')">
        <template #icon><Ellipsis :size="17" /></template>
      </NButton>
    </NDropdown>
    <NText v-if="notice" class="subscription-status" role="alert">{{ t(notice) }}</NText>
    <NText v-if="!state.persistent" class="subscription-status" depth="3">{{ t('chatgptSubscription.sessionOnly') }}</NText>
  </section>
</template>

<script lang="ts">
export type SubscriptionAccountAction = 'authorize' | 'refresh' | 'switch' | 'manageUsage' | 'disconnect'
</script>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NDropdown, NText } from 'naive-ui'
import { Ellipsis } from '@lucide/vue'
import chatgptLogo from '../assets/chatgpt-logo-white.svg'
import type { ChatGPTSubscriptionStatus } from '../types/electron'

const props = defineProps<{ state: ChatGPTSubscriptionStatus; busy: string; notice: string }>()
const emit = defineEmits<{ action: [action: SubscriptionAccountAction] }>()
const { t } = useI18n()
const needsConsent = computed(() => props.state.status === 'needsConsent' || props.notice === 'chatgptSubscription.reconnect')
const catalogLabel = computed(() => {
  if (needsConsent.value) return t('chatgptSubscription.permissionRequired')
  if (!props.state.synced) return t('chatgptSubscription.unsynced')
  return props.state.count ? t('chatgptSubscription.models', { count: props.state.count }) : t('chatgptSubscription.empty')
})
const accountActions = computed(() => [
  { key: 'switch', label: t('chatgptSubscription.switchAccount') },
  { key: 'manageUsage', label: t('chatgptSubscription.usage') },
  { key: 'disconnect', label: t('chatgptSubscription.disconnect') },
])
</script>

<style scoped>
.subscription-account { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; width: 100%; }
.subscription-logo { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 8px; background: #171717; }
.subscription-identity { display: grid; flex: 1 1 160px; min-width: 0; overflow-wrap: anywhere; }
.subscription-status { flex-basis: 100%; }
</style>

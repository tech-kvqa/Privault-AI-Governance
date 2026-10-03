<template>
  <div class="wrap d-flex align-center justify-center">
    <v-card width="460" class="pa-8">
      <div class="text-h6 font-weight-bold mb-1">Set up multi-factor authentication</div>
      <div class="text-body-2 text-medium-emphasis mb-6">Your organisation requires this before you can continue.</div>

      <template v-if="!secret">
        <v-btn block color="primary" @click="start">Start setup</v-btn>
      </template>
      <template v-else-if="!recoveryCodes">
        <div class="text-caption text-medium-emphasis mb-2">Scan in your authenticator app, or enter the secret manually:</div>
        <code class="d-block mb-3" style="word-break: break-all">{{ secret }}</code>
        <v-text-field v-model="code" label="6-digit code" class="mb-2" />
        <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-2">{{ error }}</v-alert>
        <v-btn block color="primary" @click="confirm">Confirm & continue</v-btn>
      </template>
      <template v-else>
        <v-alert type="warning" variant="tonal" density="compact" class="mb-3">Save these recovery codes now — shown only once.</v-alert>
        <div class="mb-4" style="font-family: monospace; line-height: 1.9">
          <div v-for="c in recoveryCodes" :key="c">{{ c }}</div>
        </div>
        <v-btn block color="primary" @click="finish">Continue to PRIVault</v-btn>
      </template>
    </v-card>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useAccountStore } from '../stores/account';

const auth = useAuthStore();
const account = useAccountStore();
const router = useRouter();
const secret = ref('');
const code = ref('');
const error = ref('');
const recoveryCodes = ref(null);

async function start() { const r = await account.mfaSetup(); secret.value = r.secret; }
async function confirm() {
  error.value = '';
  try {
    const r = await account.mfaEnable(code.value);
    recoveryCodes.value = r.recoveryCodes;
  } catch (e) {
    error.value = e.response?.data?.error || 'Could not verify that code';
  }
}
async function finish() { await auth.refreshSession(); router.push({ name: 'dashboard' }); }
</script>

<style scoped>
.wrap { min-height: 100vh; background: #F7F8FA; }
</style>

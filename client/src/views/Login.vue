<template>
  <div class="login-wrap d-flex align-center justify-center">
    <v-card width="440" class="pa-8">
      <div class="text-h6 font-weight-bold mb-1">PRIVault AI Governance</div>
      <div class="text-body-2 text-medium-emphasis mb-6">Sign in to the AI privacy control plane</div>

      <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4">{{ error }}</v-alert>

      <template v-if="stage === 'credentials'">
        <v-form @submit.prevent="submitCredentials">
          <v-text-field v-model="email" label="Email" type="email" autocomplete="username" class="mb-2" />
          <v-text-field v-model="password" label="Password" type="password" autocomplete="current-password" class="mb-2" />
          <v-text-field v-if="needsTenant" v-model="tenantSlug" label="Organisation handle" hint="Shown because that email is used in more than one organisation" persistent-hint class="mb-4" />
          <v-btn block color="primary" type="submit" :loading="loading">Sign in</v-btn>
        </v-form>
        <v-divider class="my-6" />
        <div class="text-caption text-medium-emphasis">
          Demo tenant "ABC Bank" — seeded users (password <code>Demo@1234</code>):
          <ul class="mt-1">
            <li>admin@abcbank.demo — Super Admin</li>
            <li>governance@abcbank.demo — AI Governance Admin</li>
            <li>auditor@abcbank.demo — Auditor</li>
            <li>readonly@abcbank.demo — Read Only</li>
          </ul>
        </div>
      </template>

      <template v-else-if="stage === 'mfa'">
        <div class="text-body-2 mb-4">Enter the 6-digit code from your authenticator app.</div>
        <v-form @submit.prevent="submitMfa">
          <v-text-field v-if="!useRecovery" v-model="code" label="Authenticator code" autocomplete="one-time-code" autofocus class="mb-2" />
          <v-text-field v-else v-model="recoveryCode" label="Recovery code" placeholder="xxxxx-xxxxx" class="mb-2" />
          <v-btn block color="primary" type="submit" class="mb-2" :loading="loading">Verify</v-btn>
          <v-btn block variant="text" size="small" @click="useRecovery = !useRecovery">
            {{ useRecovery ? 'Use an authenticator code instead' : 'Use a recovery code instead' }}
          </v-btn>
        </v-form>
      </template>
    </v-card>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const email = ref('governance@abcbank.demo');
const password = ref('');
const tenantSlug = ref('');
const needsTenant = ref(false);
const error = ref('');
const loading = ref(false);
const stage = ref('credentials');
const mfaToken = ref('');
const code = ref('');
const recoveryCode = ref('');
const useRecovery = ref(false);

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

function landingRoute(mfaSetupRequired) {
  return mfaSetupRequired ? { name: 'mfa-setup' } : (route.query.redirect || { name: 'dashboard' });
}

async function submitCredentials() {
  error.value = '';
  loading.value = true;
  try {
    const result = await auth.login(email.value, password.value, tenantSlug.value || undefined);
    if (result.needsTenant) { needsTenant.value = true; error.value = 'Enter your organisation handle to continue.'; return; }
    if (result.mfaRequired) { stage.value = 'mfa'; mfaToken.value = result.mfaToken; return; }
    router.push(landingRoute(result.mfaSetupRequired));
  } catch (e) {
    error.value = e.response?.data?.error || 'Login failed';
  } finally {
    loading.value = false;
  }
}

async function submitMfa() {
  error.value = '';
  loading.value = true;
  try {
    await auth.verifyMfa(mfaToken.value, useRecovery.value ? { recoveryCode: recoveryCode.value } : { code: code.value });
    router.push(landingRoute(false));
  } catch (e) {
    error.value = e.response?.data?.error || 'Verification failed';
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-wrap {
  min-height: 100vh;
  background: #F7F8FA;
}
</style>

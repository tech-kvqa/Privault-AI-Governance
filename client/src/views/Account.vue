<template>
  <div>
    <v-tabs v-model="tab" color="primary" class="mb-4">
      <v-tab value="security">Security</v-tab>
      <v-tab value="sessions">Sessions</v-tab>
    </v-tabs>

    <v-window v-model="tab">
      <v-window-item value="security">
        <v-alert v-if="auth.sessionRestricted" type="warning" variant="tonal" density="compact" class="mb-4">
          Your organisation requires multi-factor authentication. Finish setup below to unlock the rest of the app.
        </v-alert>

        <v-row>
          <v-col cols="12" md="6">
            <v-card class="pa-5 mb-4">
              <div class="text-subtitle-1 font-weight-medium mb-3">Change password</div>
              <v-text-field v-model="pw.current" type="password" label="Current password" autocomplete="current-password" class="mb-2" />
              <v-text-field v-model="pw.next" type="password" label="New password (at least 12 characters)" autocomplete="new-password" class="mb-2" />
              <v-alert v-if="pwError" type="error" variant="tonal" density="compact" class="mb-2">{{ pwError }}</v-alert>
              <v-alert v-if="pwOk" type="success" variant="tonal" density="compact" class="mb-2">Password changed. {{ pwOk }}</v-alert>
              <v-btn color="primary" :loading="pwBusy" @click="changePassword">Update password</v-btn>
            </v-card>
          </v-col>

          <v-col cols="12" md="6">
            <v-card class="pa-5">
              <div class="text-subtitle-1 font-weight-medium mb-3">Multi-factor authentication</div>

              <template v-if="!auth.user.mfaEnabled && !setupData">
                <div class="text-body-2 text-medium-emphasis mb-3">Not enabled. Adds an authenticator-app code to sign-in.</div>
                <v-btn color="primary" @click="startSetup">Set up MFA</v-btn>
              </template>

              <template v-else-if="setupData && !recoveryCodes">
                <div class="text-caption text-medium-emphasis mb-2">Scan this in your authenticator app, or enter the secret manually:</div>
                <code class="d-block mb-3" style="word-break: break-all">{{ setupData.secret }}</code>
                <v-text-field v-model="enableCode" label="6-digit code" class="mb-2" />
                <v-alert v-if="enableError" type="error" variant="tonal" density="compact" class="mb-2">{{ enableError }}</v-alert>
                <v-btn color="primary" @click="confirmEnable">Confirm & enable</v-btn>
              </template>

              <template v-else-if="recoveryCodes">
                <v-alert type="warning" variant="tonal" density="compact" class="mb-3">Save these recovery codes now — shown only once.</v-alert>
                <div class="mb-3" style="font-family: monospace; line-height: 1.9">
                  <div v-for="c in recoveryCodes" :key="c">{{ c }}</div>
                </div>
                <v-btn color="primary" variant="tonal" @click="recoveryCodes = null">Done</v-btn>
              </template>

              <template v-else>
                <v-chip color="success" variant="tonal" class="mb-3">Enabled</v-chip>
                <div class="d-flex" style="gap: 8px">
                  <v-btn size="small" variant="tonal" @click="openReauth('regen')">New recovery codes</v-btn>
                  <v-btn size="small" variant="tonal" color="error" @click="openReauth('disable')" :disabled="orgRequiresMfa">Disable</v-btn>
                </div>
                <div v-if="orgRequiresMfa" class="text-caption text-medium-emphasis mt-2">Your organisation requires MFA, so it can't be turned off here.</div>
              </template>
            </v-card>
          </v-col>
        </v-row>
      </v-window-item>

      <v-window-item value="sessions">
        <v-card>
          <v-table density="comfortable">
            <thead><tr><th>Device</th><th>IP</th><th>Last active</th><th>Expires</th><th></th></tr></thead>
            <tbody>
              <tr v-for="s in account.sessions" :key="s.id">
                <td class="text-caption">{{ s.userAgent || 'Unknown' }} <v-chip v-if="s.current" size="x-small" color="primary" variant="tonal" class="ml-1">this device</v-chip></td>
                <td class="text-caption">{{ s.ip }}</td>
                <td class="text-caption">{{ new Date(s.lastSeenAt).toLocaleString() }}</td>
                <td class="text-caption">{{ new Date(s.expiresAt).toLocaleString() }}</td>
                <td class="text-right"><v-btn size="small" variant="text" @click="revoke(s)">{{ s.current ? 'Sign out' : 'Revoke' }}</v-btn></td>
              </tr>
            </tbody>
          </v-table>
        </v-card>
        <v-btn class="mt-4" variant="tonal" color="error" @click="logoutAll">Sign out everywhere</v-btn>
      </v-window-item>
    </v-window>

    <v-dialog v-model="reauthDialog" max-width="420">
      <v-card>
        <v-card-title>Confirm it's you</v-card-title>
        <v-card-text>
          <v-text-field v-model="reauth.password" type="password" label="Password" class="mb-2" />
          <v-text-field v-model="reauth.code" label="Current authenticator code" class="mb-2" />
          <v-alert v-if="reauthError" type="error" variant="tonal" density="compact">{{ reauthError }}</v-alert>
        </v-card-text>
        <v-card-actions class="pa-4">
          <v-spacer />
          <v-btn variant="text" @click="reauthDialog = false">Cancel</v-btn>
          <v-btn color="primary" @click="submitReauth">Continue</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { useAuthStore } from '../stores/auth';
import { useAccountStore } from '../stores/account';

const auth = useAuthStore();
const account = useAccountStore();
const tab = ref('security');

const pw = reactive({ current: '', next: '' });
const pwBusy = ref(false);
const pwError = ref('');
const pwOk = ref('');

const setupData = ref(null);
const enableCode = ref('');
const enableError = ref('');
const recoveryCodes = ref(null);
const orgRequiresMfa = ref(false);

const reauthDialog = ref(false);
const reauthAction = ref(null);
const reauth = reactive({ password: '', code: '' });
const reauthError = ref('');

onMounted(async () => {
  await account.fetchSessions();
  try { const p = await account.fetchPolicy(); orgRequiresMfa.value = p.requireMfa; } catch { /* not permitted to view org policy */ }
});

async function changePassword() {
  pwBusy.value = true; pwError.value = ''; pwOk.value = '';
  try {
    const r = await account.changePassword(pw.current, pw.next);
    pwOk.value = r.otherSessionsRevoked ? `${r.otherSessionsRevoked} other session(s) were signed out.` : '';
    pw.current = ''; pw.next = '';
  } catch (e) {
    pwError.value = e.response?.data?.error || 'Failed to change password';
  } finally {
    pwBusy.value = false;
  }
}

async function startSetup() {
  const r = await account.mfaSetup();
  setupData.value = r;
}
async function confirmEnable() {
  enableError.value = '';
  try {
    const r = await account.mfaEnable(enableCode.value);
    recoveryCodes.value = r.recoveryCodes;
    setupData.value = null;
    await auth.refreshSession();
  } catch (e) {
    enableError.value = e.response?.data?.error || 'Could not verify that code';
  }
}

function openReauth(action) { reauthAction.value = action; Object.assign(reauth, { password: '', code: '' }); reauthError.value = ''; reauthDialog.value = true; }
async function submitReauth() {
  reauthError.value = '';
  try {
    if (reauthAction.value === 'disable') {
      await account.mfaDisable(reauth.password, reauth.code);
      await auth.refreshSession();
    } else {
      const r = await account.mfaRegenerateRecoveryCodes(reauth.password, reauth.code);
      recoveryCodes.value = r.recoveryCodes;
    }
    reauthDialog.value = false;
  } catch (e) {
    reauthError.value = e.response?.data?.error || 'Could not verify';
  }
}

async function revoke(s) {
  await account.revokeSession(s.id);
  if (s.current) { auth.clear(); window.location.href = '/login'; return; }
  await account.fetchSessions();
}
async function logoutAll() { await account.logoutAll(); auth.clear(); window.location.href = '/login'; }
</script>

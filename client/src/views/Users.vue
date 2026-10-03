<template>
  <div>
    <v-card class="pa-4 mb-4 d-flex align-center" style="gap: 16px">
      <div>
        <div class="text-subtitle-2 font-weight-medium">Require MFA for everyone in this organisation</div>
        <div class="text-caption text-medium-emphasis">{{ policy ? `${policy.enrolled} of ${policy.activeUsers} active users enrolled` : '' }}</div>
      </div>
      <v-spacer />
      <v-switch :model-value="policy?.requireMfa" density="compact" hide-details @update:model-value="togglePolicy" />
    </v-card>
    <v-alert v-if="policyNote" type="warning" variant="tonal" density="compact" class="mb-4">{{ policyNote }}</v-alert>

    <div class="d-flex justify-end mb-3">
      <v-btn color="primary" prepend-icon="mdi-plus" @click="openInvite">Invite user</v-btn>
    </div>

    <v-card>
      <v-table density="comfortable">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>MFA</th><th>Last login</th><th></th></tr></thead>
        <tbody>
          <tr v-for="u in account.users" :key="u.id">
            <td class="font-weight-medium">{{ u.name }}</td>
            <td>{{ u.email }}</td>
            <td>
              <v-select v-if="editingRole === u.id" :model-value="u.role" :items="roles" density="compact" hide-details style="max-width: 220px"
                @update:model-value="(v) => changeRole(u, v)" />
              <span v-else class="text-caption" style="cursor: pointer" @click="editingRole = u.id">{{ u.role.replaceAll('_',' ') }} <v-icon size="14">mdi-pencil</v-icon></span>
            </td>
            <td><v-chip size="small" variant="tonal" :color="statusColor(u.status)">{{ u.status }}</v-chip></td>
            <td><v-chip size="small" variant="tonal" :color="u.mfaEnabled ? 'success' : 'grey'">{{ u.mfaEnabled ? 'Enabled' : 'Off' }}</v-chip></td>
            <td class="text-caption">{{ u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never' }}</td>
            <td class="text-right" style="white-space: nowrap">
              <v-menu>
                <template #activator="{ props }"><v-btn icon="mdi-dots-vertical" variant="text" size="small" v-bind="props" /></template>
                <v-list density="compact">
                  <v-list-item @click="resetPassword(u)"><v-list-item-title>Issue password reset link</v-list-item-title></v-list-item>
                  <v-list-item v-if="u.mfaEnabled" @click="resetMfa(u)"><v-list-item-title>Reset MFA</v-list-item-title></v-list-item>
                  <v-list-item @click="revokeSessions(u)"><v-list-item-title>Revoke all sessions</v-list-item-title></v-list-item>
                  <v-list-item v-if="u.status === 'active'" @click="toggleActive(u, false)"><v-list-item-title class="text-error">Deactivate</v-list-item-title></v-list-item>
                  <v-list-item v-else-if="u.status === 'deactivated'" @click="toggleActive(u, true)"><v-list-item-title>Reactivate</v-list-item-title></v-list-item>
                </v-list>
              </v-menu>
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card>

    <v-dialog v-model="inviteDialog" max-width="480">
      <v-card>
        <v-card-title>Invite user</v-card-title>
        <v-card-text v-if="!inviteResult">
          <v-text-field v-model="inviteForm.name" label="Name *" class="mb-2" />
          <v-text-field v-model="inviteForm.email" label="Email *" class="mb-2" />
          <v-select v-model="inviteForm.role" :items="roles" label="Role *" />
          <v-alert v-if="inviteError" type="error" variant="tonal" density="compact" class="mt-2">{{ inviteError }}</v-alert>
        </v-card-text>
        <v-card-text v-else>
          <v-alert type="info" variant="tonal" density="compact" class="mb-3">No email is sent. Copy this one-time link and pass it to the new user yourself — valid 72 hours, shown only once.</v-alert>
          <code style="word-break: break-all">{{ origin }}{{ inviteResult.path }}</code>
        </v-card-text>
        <v-card-actions class="pa-4">
          <v-spacer />
          <v-btn v-if="!inviteResult" variant="text" @click="inviteDialog = false">Cancel</v-btn>
          <v-btn v-if="!inviteResult" color="primary" :loading="inviting" @click="sendInvite">Send invite</v-btn>
          <v-btn v-else color="primary" @click="inviteDialog = false">Done</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="linkDialog" max-width="480">
      <v-card>
        <v-card-title>Password reset link</v-card-title>
        <v-card-text>
          <v-alert type="info" variant="tonal" density="compact" class="mb-3">No email is sent. Copy this one-time link and pass it to the user — valid 24 hours, shown only once.</v-alert>
          <code style="word-break: break-all">{{ origin }}{{ linkPath }}</code>
        </v-card-text>
        <v-card-actions class="pa-4"><v-spacer /><v-btn color="primary" @click="linkDialog = false">Done</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useAccountStore } from '../stores/account';

const account = useAccountStore();
const policy = ref(null);
const policyNote = ref('');
const roles = ['SUPER_ADMIN', 'AI_GOVERNANCE_ADMIN', 'PRIVACY_OFFICER', 'DPO', 'AI_SYSTEM_OWNER', 'DATA_OWNER', 'SECURITY_ADMIN', 'AUDITOR', 'HUMAN_REVIEWER', 'INCIDENT_MANAGER', 'READ_ONLY', 'CUSTOMER_APPEAL_USER'];
const editingRole = ref(null);
const origin = computed(() => window.location.origin);

const inviteDialog = ref(false);
const inviteForm = reactive({ name: '', email: '', role: 'READ_ONLY' });
const inviteError = ref('');
const inviting = ref(false);
const inviteResult = ref(null);

const linkDialog = ref(false);
const linkPath = ref('');

onMounted(async () => { await account.fetchUsers(); policy.value = await account.fetchPolicy(); });

function statusColor(s) { return { active: 'success', invited: 'warning', locked: 'error', deactivated: 'grey' }[s] || 'grey'; }

async function togglePolicy(v) {
  policyNote.value = '';
  try {
    const r = await account.updatePolicy(v);
    policy.value = await account.fetchPolicy();
    if (v && r.sessionsRestricted) policyNote.value = `${r.sessionsRestricted} active session(s) for unenrolled users are now restricted to completing MFA setup.`;
  } catch (e) {
    policyNote.value = e.response?.data?.error || 'Could not update the policy';
  }
}

function openInvite() { inviteError.value = ''; inviteResult.value = null; Object.assign(inviteForm, { name: '', email: '', role: 'READ_ONLY' }); inviteDialog.value = true; }
async function sendInvite() {
  inviting.value = true; inviteError.value = '';
  try {
    const r = await account.inviteUser({ ...inviteForm });
    inviteResult.value = r.invite;
    await account.fetchUsers();
  } catch (e) {
    inviteError.value = e.response?.data?.error || 'Failed to invite';
  } finally {
    inviting.value = false;
  }
}

async function changeRole(u, role) {
  editingRole.value = null;
  if (role === u.role) return;
  try { await account.updateUser(u.id, { role }); await account.fetchUsers(); }
  catch (e) { alert(e.response?.data?.error || 'Could not change role'); } // eslint-disable-line no-alert
}
async function toggleActive(u, isActive) { await account.updateUser(u.id, { isActive }); await account.fetchUsers(); }
async function resetPassword(u) { const r = await account.resetUserPassword(u.id); linkPath.value = r.reset.path; linkDialog.value = true; }
async function resetMfa(u) { await account.resetUserMfa(u.id); await account.fetchUsers(); }
async function revokeSessions(u) { await account.revokeUserSessions(u.id); }
</script>

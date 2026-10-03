<template>
  <div class="wrap">
    <div class="shell">
      <template v-if="portal.info">
        <div class="text-h6 font-weight-bold mb-1">{{ portal.info.organisation }}</div>
        <div class="text-body-2 text-medium-emphasis mb-6">Submit a request about your personal data.</div>

        <template v-if="!result">
          <v-form @submit.prevent="submit">
            <v-select v-model="form.requestType" :items="portal.info.requestTypes" item-title="label" item-value="value" label="What would you like to do? *" class="mb-2" />
            <v-text-field v-model="form.requesterName" label="Your name *" class="mb-2" />
            <div class="d-flex" style="gap: 12px">
              <v-select v-model="form.contactType" :items="['EMAIL', 'PHONE']" label="Contact by" style="max-width: 140px" class="mb-2" />
              <v-text-field v-model="form.contactValue" :label="form.contactType === 'EMAIL' ? 'Email *' : 'Phone *'" class="mb-2" />
            </div>
            <v-text-field v-model="form.dataSubjectIdentifier" label="Identifier you're known by (email, customer ID…)" hint="Helps us find your data faster; optional" persistent-hint class="mb-3" />
            <v-checkbox v-model="form.isNominee" label="I'm submitting this on behalf of someone else (as their nominee)" density="compact" hide-details />
            <v-text-field v-if="form.isNominee" v-model="form.nomineeRelationship" label="Your relationship to them" class="mb-2" />
            <v-textarea v-model="form.details" label="Anything else that would help" rows="3" class="my-2" />
            <!-- honeypot: hidden from real people, a bot may fill it -->
            <input v-model="form.website" name="website" autocomplete="off" tabindex="-1" style="position:absolute; left:-9999px" aria-hidden="true" />
            <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-3">{{ error }}</v-alert>
            <v-btn block color="primary" type="submit" :loading="busy">Submit request</v-btn>
          </v-form>
        </template>

        <template v-else>
          <v-alert type="success" variant="tonal" density="compact" class="mb-4">Your request was received.</v-alert>
          <div class="text-caption text-medium-emphasis mb-1">Reference</div>
          <code class="d-block mb-3">{{ result.reference }}</code>
          <div class="text-caption text-medium-emphasis mb-1">Status token — save this, it is shown only once</div>
          <code class="d-block mb-3" style="word-break: break-all">{{ result.statusToken }}</code>
          <div class="text-body-2 mb-4">We expect to respond by {{ new Date(result.respondBy).toLocaleDateString() }}. {{ result.note }}</div>
          <v-btn color="primary" variant="tonal" :to="{ name: 'portal-status', params: { slug } }">Check status later</v-btn>
        </template>

        <v-divider class="my-6" />
        <div v-if="portal.info.dpo" class="text-caption text-medium-emphasis">
          Data Protection Officer: {{ portal.info.dpo.name }}
          <span v-if="portal.info.dpo.email"> · {{ portal.info.dpo.email }}</span>
          <span v-if="portal.info.dpo.phone"> · {{ portal.info.dpo.phone }}</span>
        </div>
      </template>
      <v-alert v-else-if="portal.error" type="error" variant="tonal" density="compact">{{ portal.error }}</v-alert>
    </div>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { usePortalStore } from '../../stores/portal';

const route = useRoute();
const slug = route.params.slug;
const portal = usePortalStore();
const busy = ref(false);
const error = ref('');
const result = ref(null);

const form = reactive({ requestType: 'ACCESS', requesterName: '', contactType: 'EMAIL', contactValue: '', dataSubjectIdentifier: '', isNominee: false, nomineeRelationship: '', details: '', website: '' });

onMounted(() => portal.fetchInfo(slug));

async function submit() {
  error.value = ''; busy.value = true;
  try { result.value = await portal.submit(slug, { ...form }); }
  catch (e) { error.value = e.response?.data?.error || 'Could not submit your request'; }
  finally { busy.value = false; }
}
</script>

<style scoped>
.wrap { min-height: 100vh; background: #F7F8FA; display: flex; align-items: flex-start; justify-content: center; padding: 48px 16px; }
.shell { width: 100%; max-width: 560px; background: #FFFFFF; border: 1px solid #E1E4E8; border-radius: 12px; padding: 32px; }
</style>

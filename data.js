// Data layer. SupabaseBackend talks to your Supabase project; DemoBackend keeps everything in
// this browser so the app can be tried before Supabase is set up.

const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

const ITEM_COLUMNS = [
  "id", "household_id", "kind", "title", "notes", "done", "urgent", "due_at", "repeat",
  "assignee", "created_by", "created_at", "completed_at", "last_done_by",
];

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));

function fail(error) {
  if (error) throw new Error(error.message || String(error));
}

export async function createBackend(config) {
  if (config.SUPABASE_URL && config.SUPABASE_KEY) {
    const { createClient } = await import(SUPABASE_JS);
    return new SupabaseBackend(createClient(config.SUPABASE_URL, config.SUPABASE_KEY));
  }
  return new DemoBackend();
}

class SupabaseBackend {
  demo = false;
  channel = null;

  constructor(client) {
    this.sb = client;
  }

  // ── Account ──
  async currentUser() {
    const { data } = await this.sb.auth.getSession();
    return data.session?.user ?? null;
  }

  onAuthChange(callback) {
    this.sb.auth.onAuthStateChange((_event, session) => callback(session?.user ?? null));
  }

  async signUp(email, password) {
    const { data, error } = await this.sb.auth.signUp({ email, password });
    fail(error);
    return { needsConfirmation: !data.session };
  }

  async signIn(email, password) {
    const { error } = await this.sb.auth.signInWithPassword({ email, password });
    fail(error);
  }

  async signOut() {
    await this.unsubscribe();
    await this.sb.auth.signOut();
  }

  // ── Household ──
  async loadHousehold(userId) {
    const { data: me, error } = await this.sb.from("members").select("household_id").eq("user_id", userId).maybeSingle();
    fail(error);
    if (!me) return null;
    const [h, m] = await Promise.all([
      this.sb.from("households").select("*").eq("id", me.household_id).single(),
      this.sb.from("members").select("user_id, name").eq("household_id", me.household_id).order("joined_at"),
    ]);
    fail(h.error);
    fail(m.error);
    return { household: h.data, members: m.data };
  }

  async createHousehold(memberName) {
    const { error } = await this.sb.rpc("create_household", { member_name: memberName });
    fail(error);
  }

  async joinHousehold(code, memberName) {
    const { error } = await this.sb.rpc("join_household", { code, member_name: memberName });
    fail(error);
  }

  async renameMe(userId, name) {
    const { error } = await this.sb.from("members").update({ name }).eq("user_id", userId);
    fail(error);
  }

  // ── Items ──
  async listItems(householdId) {
    const { data, error } = await this.sb.from("items").select("*").eq("household_id", householdId).order("created_at");
    fail(error);
    return data;
  }

  async saveItem(item) {
    const { error } = await this.sb.from("items").upsert(pick(item, ITEM_COLUMNS));
    fail(error);
  }

  async deleteItems(ids) {
    if (!ids.length) return;
    const { error } = await this.sb.from("items").delete().in("id", ids);
    fail(error);
  }

  // ── Pings ──
  async sendPing(householdId, message, itemId = null) {
    const { data, error } = await this.sb.from("pings")
      .insert({ household_id: householdId, message, item_id: itemId })
      .select("id").single();
    fail(error);
    const { data: result, error: fnError } = await this.sb.functions.invoke("notify", { body: { ping_id: data.id } });
    if (fnError) throw new Error("Saved, but the notification couldn't be sent. Is the notify function set up? (README step 4)");
    return result; // { sent, phones }
  }

  async savePushSubscription(householdId, subscription) {
    const json = subscription.toJSON();
    const { error } = await this.sb.from("push_subscriptions").upsert({
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      household_id: householdId,
    }, { onConflict: "endpoint" });
    fail(error);
  }

  async removePushSubscription(endpoint) {
    await this.sb.from("push_subscriptions").delete().eq("endpoint", endpoint);
  }

  // ── Live updates ──
  subscribe(householdId, { onItem, onItemDeleted, onMembers, onPing, onStatus }) {
    this.unsubscribe();
    const filter = `household_id=eq.${householdId}`;
    this.channel = this.sb.channel(`household-${householdId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "items", filter }, (p) => onItem(p.new))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "items", filter }, (p) => onItem(p.new))
      // Delete events can't be filtered; they only carry the id.
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "items" }, (p) => onItemDeleted(p.old.id))
      .on("postgres_changes", { event: "*", schema: "public", table: "members", filter }, () => onMembers())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "pings", filter }, (p) => onPing(p.new))
      .subscribe((status) => onStatus?.(status));
  }

  async unsubscribe() {
    if (this.channel) {
      const channel = this.channel;
      this.channel = null;
      await this.sb.removeChannel(channel);
    }
  }
}

/** Everything in localStorage, with a pretend partner. */
class DemoBackend {
  demo = true;
  key = "hearth-demo";
  user = { id: "demo-me", email: "demo@hearth.local" };

  read() {
    try {
      return JSON.parse(localStorage.getItem(this.key)) ?? {};
    } catch {
      return {};
    }
  }

  write(data) {
    try {
      localStorage.setItem(this.key, JSON.stringify(data));
    } catch { /* storage unavailable: keep in memory only */ }
    this.memory = data;
  }

  get data() {
    return this.memory ?? (this.memory = this.read());
  }

  async currentUser() { return this.user; }
  onAuthChange() {}
  async signUp() { return { needsConfirmation: false }; }
  async signIn() {}
  async signOut() { this.write({}); location.reload(); }

  async loadHousehold() {
    const d = this.data;
    if (!d.household) return null;
    return { household: d.household, members: d.members };
  }

  async createHousehold(name) {
    this.write({
      household: { id: "demo-home", name: "Our Home", join_code: "DEMO42" },
      members: [{ user_id: this.user.id, name }, { user_id: "demo-partner", name: "Partner" }],
      items: [],
    });
  }

  async joinHousehold(_code, name) { return this.createHousehold(name); }

  async renameMe(userId, name) {
    const d = this.data;
    d.members = d.members.map((m) => (m.user_id === userId ? { ...m, name } : m));
    this.write(d);
  }

  async listItems() { return structuredClone(this.data.items ?? []); }

  async saveItem(item) {
    const d = this.data;
    const row = { ...pick(item, ITEM_COLUMNS), updated_at: new Date().toISOString() };
    const i = d.items.findIndex((x) => x.id === item.id);
    if (i >= 0) d.items[i] = row; else d.items.push(row);
    this.write(d);
  }

  async deleteItems(ids) {
    const d = this.data;
    d.items = d.items.filter((x) => !ids.includes(x.id));
    this.write(d);
  }

  async sendPing() { return { sent: 0, phones: 0, demo: true }; }
  async savePushSubscription() {}
  async removePushSubscription() {}
  subscribe(_id, { onStatus }) { onStatus?.("DEMO"); }
  async unsubscribe() {}
}

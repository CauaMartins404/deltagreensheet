// Banco de dados falso, só para os testes (imita o básico do MongoDB).
import crypto from "node:crypto";

const clone = value => structuredClone(value);
const get = (doc, path) => path.split(".").reduce((v, k) => (v == null ? v : v[k]), doc);

function matches(doc, filter = {}) {
  return Object.entries(filter).every(([key, cond]) => {
    const value = get(doc, key);
    if (cond && typeof cond === "object" && !(cond instanceof Date) && !Array.isArray(cond)) {
      if ("$in" in cond) return cond.$in.includes(value);
      if ("$ne" in cond) return value !== cond.$ne;
      if ("$exists" in cond) return (value !== undefined) === cond.$exists;
      if ("$gte" in cond) return value >= cond.$gte;
    }
    return value === cond || String(value) === String(cond);
  });
}

class Cursor {
  constructor(docs) { this.docs = docs; }
  sort(spec) {
    const keys = Object.entries(spec);
    this.docs.sort((a, b) => {
      for (const [k, dir] of keys) {
        const x = get(a, k), y = get(b, k);
        if (x < y) return -dir;
        if (x > y) return dir;
      }
      return 0;
    });
    return this;
  }
  limit(n) { this.docs = this.docs.slice(0, n); return this; }
  async toArray() { return clone(this.docs); }
}

class Collection {
  constructor(unique = []) { this.docs = []; this.unique = unique; }
  async createIndex() { return "ok"; }
  async findOne(filter) { const d = this.docs.find(x => matches(x, filter)); return d ? clone(d) : null; }
  find(filter = {}, options = {}) {
    let docs = this.docs.filter(x => matches(x, filter)).map(clone);
    if (options.projection) {
      const keys = Object.keys(options.projection).filter(k => options.projection[k]);
      docs = docs.map(d => Object.fromEntries([["_id", d._id], ...keys.map(k => [k, d[k]])]));
    }
    return new Cursor(docs);
  }
  async insertOne(doc) {
    for (const field of this.unique) {
      if (this.docs.some(d => d[field] === doc[field])) throw Object.assign(new Error("duplicate"), { code: 11000 });
    }
    const _id = doc._id || crypto.randomBytes(12).toString("hex");
    this.docs.push(clone({ ...doc, _id }));
    return { insertedId: _id };
  }
  async updateOne(filter, update) {
    const doc = this.docs.find(x => matches(x, filter));
    if (!doc) return { matchedCount: 0, modifiedCount: 0 };
    Object.assign(doc, clone(update.$set || {}));
    for (const [k, n] of Object.entries(update.$inc || {})) doc[k] = (doc[k] || 0) + n;
    return { matchedCount: 1, modifiedCount: 1 };
  }
  async deleteOne(filter) {
    const index = this.docs.findIndex(x => matches(x, filter));
    if (index >= 0) this.docs.splice(index, 1);
    return { deletedCount: index >= 0 ? 1 : 0 };
  }
  async countDocuments(filter = {}) { return this.docs.filter(x => matches(x, filter)).length; }
  async distinct(field) { return [...new Set(this.docs.map(d => d[field]))]; }
}

export function fakeDb(uniqueByCollection = {}) {
  const collections = {};
  return {
    collections,
    collection(name) {
      collections[name] ||= new Collection(uniqueByCollection[name]);
      return collections[name];
    }
  };
}

export const fakeIds = {
  toId: value => (/^[0-9a-f]{24}$/.test(String(value || "")) ? String(value) : null),
  idStr: value => String(value)
};

// "Hash" falso só para teste (o site de verdade usa bcrypt).
export const fakeHash = {
  hashPassword: async p => `hash:${p}`,
  comparePassword: async (p, h) => h === `hash:${p}`
};

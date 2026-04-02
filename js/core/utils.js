export const nowIso = () => new Date().toISOString();

export const uid = (prefix = "id") => {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
};

export const clone = (value) => structuredClone(value);

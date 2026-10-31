// Stands in for Codex's shared bundle: the panel finds these helpers by their content, not their names.
const store = {
  theme: 'system',
  read() {
    return this.theme;
  },
  write(value) {
    if (window.failThemeWrite) throw Error('write refused');
    this.theme = value;
    document.documentElement.classList.toggle('dark', value === 'dark');
  }
};

export async function Tot() {
  if (!store) throw Error('Settings are unavailable on this host');
  return store.read();
}

export async function Fot(setting, value) {
  if (!store) throw Error('Settings are unavailable on this host');
  store.write(value);
}

export const unrelated = () => 'nothing here';

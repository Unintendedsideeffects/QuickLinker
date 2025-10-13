const {
  Plugin,
  Notice,
  PluginSettingTab,
  moment,
  normalizePath,
  Setting,
  TFile,
  requestUrl
} = require('obsidian');

const { promises: fsPromises } = require('fs');
const nodePath = require('path');
const os = require('os');

const MAX_TITLE_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 500;

const DEFAULT_SETTINGS = {
  dailyFolder: 'Daily',
  dailyFileDateFormat: 'YYYY-MM-DD',
  clipFolder: 'Attachments/Clippings',
  wishlistBasePath: 'Bases/Wishlist.base',
  readingListBasePath: 'Bases/ReadingList.base',
  openRouterApiKey: '',
  openRouterKeyPath: '',
  openRouterModel: 'anthropic/claude-3.5-sonnet',
  fetchTimeoutSeconds: 20,
  modifyDebounceMs: 1500,
  maxCharactersFromPage: 2000,
  processedLinks: {},
  classificationFallback: 'article'
};

class DailyLinkClipperPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.debounceHandles = new Map();
    this.keyFileErrorNotified = false;
    this.keyFileEmptyNotified = false;
    this.registerEvent(this.app.vault.on('modify', (file) => this.onFileModify(file)));
    this.addCommand({
      id: 'process-todays-daily-links',
      name: "Process today's daily links",
      callback: async () => {
        const file = this.getTodayDailyFile();
        if (file) {
          await this.processDailyFile(file);
          new Notice('Daily Link Clipper finished processing the current daily note.');
        } else {
          new Notice('Daily Link Clipper could not find today\'s daily note.');
        }
      }
    });
    this.addSettingTab(new DailyLinkClipperSettingTab(this.app, this));
    const startupFile = this.getTodayDailyFile();
    if (startupFile) {
      await this.processDailyFile(startupFile);
    }
  }

  onunload() {
    this.debounceHandles.forEach((handle) => window.clearTimeout(handle));
    this.debounceHandles.clear();
  }

  async loadSettings() {
    const stored = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, stored || {});
    if (!this.settings.processedLinks) {
      this.settings.processedLinks = {};
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  getTodayDailyPath() {
    const fileName = `${moment().format(this.settings.dailyFileDateFormat)}.md`;
    return normalizePath(`${this.settings.dailyFolder}/${fileName}`);
  }

  getTodayDailyFile() {
    const path = this.getTodayDailyPath();
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      return file;
    }
    return null;
  }

  getParentFolder(path) {
    if (!path) {
      return '';
    }
    const normalized = normalizePath(path);
    const index = normalized.lastIndexOf('/');
    if (index === -1) {
      return '';
    }
    return normalized.substring(0, index);
  }

  getVaultBasePath() {
    const adapter = this.app.vault?.adapter;
    if (adapter?.getBasePath) {
      return adapter.getBasePath();
    }
    if (adapter?.basePath) {
      return adapter.basePath;
    }
    return null;
  }

  resolveKeyPath(inputPath) {
    if (!inputPath) {
      return null;
    }
    let candidate = inputPath.trim();
    if (!candidate) {
      return null;
    }
    if (candidate.startsWith('~')) {
      candidate = nodePath.join(os.homedir(), candidate.slice(1));
    }
    if (!nodePath.isAbsolute(candidate)) {
      const base = this.getVaultBasePath();
      if (base) {
        candidate = nodePath.resolve(base, candidate);
      }
    }
    return candidate;
  }

  async getOpenRouterApiKey() {
    if (typeof process !== 'undefined' && process?.env) {
      const envCandidates = ['OPENROUTER_API_KEY', 'OPENROUTERKEY'];
      for (const variable of envCandidates) {
        const candidate = process.env[variable];
        if (candidate && candidate.trim()) {
          return candidate.trim();
        }
      }
    }
    const pathSetting = (this.settings.openRouterKeyPath || '').trim();
    if (pathSetting) {
      const resolved = this.resolveKeyPath(pathSetting);
      if (resolved) {
        try {
          const fileKey = (await fsPromises.readFile(resolved, 'utf8')).trim();
          if (fileKey) {
            return fileKey;
          }
          if (!this.keyFileEmptyNotified) {
            new Notice('Daily Link Clipper: OpenRouter key file is empty.');
            this.keyFileEmptyNotified = true;
          }
        } catch (error) {
          console.error('Daily Link Clipper could not read OpenRouter key file', error);
          if (!this.keyFileErrorNotified) {
            new Notice('Daily Link Clipper could not read the OpenRouter key file. Check console for details.');
            this.keyFileErrorNotified = true;
          }
        }
      }
    }
    return (this.settings.openRouterApiKey || '').trim();
  }

  onFileModify(file) {
    if (!(file instanceof TFile) || file.extension !== 'md') {
      return;
    }
    const todayPath = this.getTodayDailyPath();
    if (normalizePath(file.path) !== todayPath) {
      return;
    }
    const previousHandle = this.debounceHandles.get(file.path);
    if (previousHandle) {
      window.clearTimeout(previousHandle);
    }
    const handle = window.setTimeout(async () => {
      await this.processDailyFile(file);
    }, this.settings.modifyDebounceMs);
    this.debounceHandles.set(file.path, handle);
  }

  async processDailyFile(file) {
    if (!(file instanceof TFile)) {
      return;
    }
    const content = await this.app.vault.read(file);
    const links = this.extractLinks(content);
    if (!this.settings.processedLinks[file.path]) {
      this.settings.processedLinks[file.path] = [];
    }
    const alreadyProcessed = new Set(this.settings.processedLinks[file.path]);
    const newLinks = links.filter((link) => !alreadyProcessed.has(link));
    if (!newLinks.length) {
      return;
    }
    for (const link of newLinks) {
      try {
        await this.handleLink(link, file);
        this.settings.processedLinks[file.path].push(link);
        await this.saveSettings();
      } catch (error) {
        console.error('Daily Link Clipper failed to process link', link, error);
        new Notice(`Failed to process link: ${link}`);
      }
    }
  }

  extractLinks(content) {
    const result = new Set();
    const markdownLinkPattern = /\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g;
    const bareUrlPattern = /(https?:\/\/[^\s<>()"']+)/g;
    let match;
    while ((match = markdownLinkPattern.exec(content)) !== null) {
      result.add(match[1]);
    }
    while ((match = bareUrlPattern.exec(content)) !== null) {
      result.add(match[1]);
    }
    return Array.from(result);
  }

  async handleLink(url, sourceFile) {
    new Notice(`Clipping ${url}`);
    const page = await this.fetchPage(url);
    const metadata = this.extractMetadata(url, page);
    const category = await this.classifyLink(metadata);
    const noteContent = this.buildNoteContent(metadata, category, sourceFile.path);
    const notePath = await this.createClippingNote(metadata, noteContent);
    await this.appendToBase(category, metadata, notePath);
    new Notice(`Saved clip for ${metadata.title || url}`);
  }

  async fetchPage(url) {
    try {
      const response = await requestUrl({
        url,
        method: 'GET',
        headers: {
          'User-Agent': 'ObsidianDailyLinkClipper/0.1'
        },
        timeout: this.settings.fetchTimeoutSeconds * 1000
      });
      return {
        status: response.status,
        html: response.text || ''
      };
    } catch (error) {
      console.error('Daily Link Clipper fetch failed', error);
      return {
        status: 500,
        html: ''
      };
    }
  }

  extractMetadata(url, page) {
    const metadata = {
      url,
      title: url,
      description: '',
      text: '',
      status: page.status
    };
    if (page.html) {
      try {
        const parser = typeof DOMParser !== 'undefined' ? new DOMParser() : null;
        const doc = parser ? parser.parseFromString(page.html, 'text/html') : null;
        if (doc) {
          const titleEl = doc.querySelector('title');
          if (titleEl && titleEl.textContent) {
            metadata.title = this.truncate(titleEl.textContent.trim(), MAX_TITLE_LENGTH);
          }
          const descriptionMeta = doc.querySelector('meta[name="description"], meta[property="og:description"]');
          if (descriptionMeta && descriptionMeta.getAttribute('content')) {
            metadata.description = this.truncate(descriptionMeta.getAttribute('content').trim(), MAX_DESCRIPTION_LENGTH);
          }
          const bodyText = doc.body ? doc.body.innerText : '';
          if (bodyText) {
            const cleaned = bodyText.replace(/\s+/g, ' ').trim();
            metadata.text = this.truncate(cleaned, this.settings.maxCharactersFromPage);
          }
        }
      } catch (error) {
        console.error('Daily Link Clipper could not parse HTML', error);
      }
    }
    if (!metadata.title) {
      metadata.title = this.truncate(url, MAX_TITLE_LENGTH);
    }
    if (!metadata.description) {
      metadata.description = '';
    }
    if (!metadata.text) {
      metadata.text = '';
    }
    return metadata;
  }

  async classifyLink(metadata) {
    const apiKey = await this.getOpenRouterApiKey();
    if (apiKey) {
      try {
        const prompt = this.composeClassificationPrompt(metadata);
        const response = await requestUrl({
          url: 'https://openrouter.ai/api/v1/chat/completions',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: this.settings.openRouterModel,
            messages: [
              { role: 'system', content: 'Classify the provided webpage as product or article. Respond with just the lowercase label.' },
              { role: 'user', content: prompt }
            ],
            temperature: 0
          }),
          timeout: this.settings.fetchTimeoutSeconds * 1000
        });
        const data = JSON.parse(response.text);
        const choice = data?.choices?.[0]?.message?.content?.trim().toLowerCase();
        if (choice === 'product' || choice === 'article') {
          return choice;
        }
      } catch (error) {
        console.error('Daily Link Clipper classification failed', error);
      }
    }
    return this.heuristicClassification(metadata);
  }

  composeClassificationPrompt(metadata) {
    const summary = [
      `URL: ${metadata.url}`,
      metadata.title ? `Title: ${metadata.title}` : '',
      metadata.description ? `Description: ${metadata.description}` : '',
      metadata.text ? `Excerpt: ${metadata.text.slice(0, 400)}` : ''
    ].filter(Boolean).join('\n');
    return `${summary}\n\nRespond with either "product" or "article".`;
  }

  heuristicClassification(metadata) {
    const productKeywords = ['product', 'buy', 'store', 'shop', 'cart', 'price', 'sale'];
    const host = this.tryParseHost(metadata.url);
    const text = `${metadata.title} ${metadata.description}`.toLowerCase();
    if (host) {
      if (/amazon|etsy|ebay|aliexpress|ikea|nike|store|shop/.test(host)) {
        return 'product';
      }
    }
    if (productKeywords.some((keyword) => text.includes(keyword))) {
      return 'product';
    }
    return this.settings.classificationFallback === 'product' ? 'product' : 'article';
  }

  tryParseHost(url) {
    try {
      return new URL(url).host.toLowerCase();
    } catch (error) {
      return null;
    }
  }

  formatFrontmatterValue(value) {
    if (value === null || value === undefined) {
      return '""';
    }
    if (typeof value !== 'string') {
      value = String(value);
    }
    if (!value.length) {
      return '""';
    }
    return JSON.stringify(value);
  }

  truncate(value, limit) {
    if (!value || !limit || value.length <= limit) {
      return value || '';
    }
    return `${value.slice(0, limit - 1)}…`;
  }

  buildNoteContent(metadata, category, sourcePath) {
    const captured = moment().format('YYYY-MM-DD HH:mm');
    const lines = [];
    lines.push('---');
    lines.push(`title: ${this.formatFrontmatterValue(metadata.title || metadata.url)}`);
    lines.push(`source: ${this.formatFrontmatterValue(metadata.url)}`);
    lines.push(`captured: ${this.formatFrontmatterValue(captured)}`);
    lines.push(`category: ${this.formatFrontmatterValue(category)}`);
    lines.push(`origin: ${this.formatFrontmatterValue(sourcePath)}`);
    lines.push('---');
    const displayTitle = (metadata.title || metadata.url).replace(/\s+/g, ' ').trim();
    lines.push('');
    lines.push(`# ${displayTitle}`);
    if (metadata.description) {
      lines.push('');
      lines.push(`> ${metadata.description}`);
    }
    if (metadata.text) {
      lines.push('');
      lines.push(metadata.text);
    }
    lines.push('');
    lines.push(`Original link: ${metadata.url}`);
    return lines.join('\n');
  }

  async createClippingNote(metadata, content) {
    const folderPath = normalizePath(this.settings.clipFolder);
    await this.ensureFolderExists(folderPath);
    const baseName = this.sanitizeFileName(metadata.title || metadata.url);
    let attempt = 0;
    while (attempt < 100) {
      const suffix = attempt === 0 ? '' : `-${attempt}`;
      const candidatePath = normalizePath(`${folderPath}/${baseName}${suffix}.md`);
      const existing = this.app.vault.getAbstractFileByPath(candidatePath);
      if (existing instanceof TFile) {
        try {
          const existingContent = await this.app.vault.read(existing);
          if (existingContent.includes(metadata.url)) {
            await this.app.vault.modify(existing, content);
            return candidatePath;
          }
        } catch (error) {
          console.error('Daily Link Clipper could not read existing clip', error);
        }
        attempt += 1;
        continue;
      }
      await this.app.vault.create(candidatePath, content);
      return candidatePath;
    }
    throw new Error('Daily Link Clipper could not create a unique clipping note name.');
  }

  sanitizeFileName(name) {
    return name
      .replace(/[\\/:*?"<>|#]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80)
      || 'clipped-link';
  }

  async ensureFolderExists(path) {
    const segments = normalizePath(path).split('/');
    let current = segments.shift();
    if (!current) {
      return;
    }
    let traversed = current;
    const vault = this.app.vault;
    if (!vault.getAbstractFileByPath(traversed)) {
      await vault.createFolder(traversed);
    }
    while (segments.length) {
      const segment = segments.shift();
      traversed = `${traversed}/${segment}`;
      const file = vault.getAbstractFileByPath(traversed);
      if (!file) {
        await vault.createFolder(traversed);
      }
    }
  }

  async appendToBase(category, metadata, notePath) {
    const entry = {
      title: metadata.title,
      url: metadata.url,
      clippedNote: notePath,
      captured: moment().format(),
      status: category === 'product' ? 'wishlist' : 'to-read'
    };
    const basePath = category === 'product' ? this.settings.wishlistBasePath : this.settings.readingListBasePath;
    const normalized = normalizePath(basePath);
    const parent = this.getParentFolder(normalized);
    if (parent) {
      await this.ensureFolderExists(parent);
    }
    let existingFile = this.app.vault.getAbstractFileByPath(normalized);
    if (!(existingFile instanceof TFile)) {
      const initial = JSON.stringify({ entries: [entry] }, null, 2);
      await this.app.vault.create(normalized, `${initial}\n`);
      return;
    }
    try {
      const raw = await this.app.vault.read(existingFile);
      let data;
      try {
        data = JSON.parse(raw);
      } catch (error) {
        data = { entries: [] };
      }
      if (!Array.isArray(data.entries)) {
        data.entries = [];
      }
      const exists = data.entries.some((item) => item.url === entry.url);
      if (!exists) {
        data.entries.push(entry);
        await this.app.vault.modify(existingFile, `${JSON.stringify(data, null, 2)}\n`);
      }
    } catch (error) {
      console.error('Daily Link Clipper could not update base file', error);
    }
  }
}

class DailyLinkClipperSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Daily Link Clipper' });

    new Setting(containerEl)
      .setName('Daily folder')
      .setDesc('Relative path that holds daily notes.')
      .addText((text) => text
        .setPlaceholder('Daily')
        .setValue(this.plugin.settings.dailyFolder)
        .onChange(async (value) => {
          this.plugin.settings.dailyFolder = value.trim() || 'Daily';
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Daily file date format')
      .setDesc('Moment.js format for the daily file name.')
      .addText((text) => text
        .setPlaceholder('YYYY-MM-DD')
        .setValue(this.plugin.settings.dailyFileDateFormat)
        .onChange(async (value) => {
          this.plugin.settings.dailyFileDateFormat = value.trim() || 'YYYY-MM-DD';
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Clip folder')
      .setDesc('Folder where clipped notes should be stored.')
      .addText((text) => text
        .setPlaceholder('Attachments/Clippings')
        .setValue(this.plugin.settings.clipFolder)
        .onChange(async (value) => {
          this.plugin.settings.clipFolder = value.trim() || 'Attachments/Clippings';
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Wishlist base path')
      .setDesc('File that stores JSON entries for products.')
      .addText((text) => text
        .setPlaceholder('Bases/Wishlist.base')
        .setValue(this.plugin.settings.wishlistBasePath)
        .onChange(async (value) => {
          this.plugin.settings.wishlistBasePath = value.trim() || 'Bases/Wishlist.base';
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Reading list base path')
      .setDesc('File that stores JSON entries for articles.')
      .addText((text) => text
        .setPlaceholder('Bases/ReadingList.base')
        .setValue(this.plugin.settings.readingListBasePath)
        .onChange(async (value) => {
          this.plugin.settings.readingListBasePath = value.trim() || 'Bases/ReadingList.base';
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('OpenRouter API key')
      .setDesc('Stored locally. Required for model-based classification. Leave blank to use heuristics.')
      .addText((text) => text
        .setPlaceholder('sk-or-...')
        .setValue(this.plugin.settings.openRouterApiKey)
        .onChange(async (value) => {
          this.plugin.settings.openRouterApiKey = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('OpenRouter key file path')
      .setDesc('Optional absolute or vault-relative path to a file containing the API key. Tilde (~/) is supported.')
      .addText((text) => text
        .setPlaceholder('~/secrets/openrouter.key')
        .setValue(this.plugin.settings.openRouterKeyPath)
        .onChange(async (value) => {
          this.plugin.settings.openRouterKeyPath = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('OpenRouter model')
      .setDesc('Model identifier for classification requests.')
      .addText((text) => text
        .setPlaceholder('anthropic/claude-3.5-sonnet')
        .setValue(this.plugin.settings.openRouterModel)
        .onChange(async (value) => {
          this.plugin.settings.openRouterModel = value.trim() || 'anthropic/claude-3.5-sonnet';
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Fetch timeout (seconds)')
      .setDesc('Maximum time to wait when downloading a page or calling OpenRouter.')
      .addSlider((slider) => slider
        .setLimits(5, 60, 1)
        .setValue(this.plugin.settings.fetchTimeoutSeconds)
        .onChange(async (value) => {
          this.plugin.settings.fetchTimeoutSeconds = value;
          await this.plugin.saveSettings();
        })
        .setDynamicTooltip());

    new Setting(containerEl)
      .setName('Modify debounce (ms)')
      .setDesc('Delay after edits before processing the daily note again.')
      .addSlider((slider) => slider
        .setLimits(250, 5000, 50)
        .setValue(this.plugin.settings.modifyDebounceMs)
        .onChange(async (value) => {
          this.plugin.settings.modifyDebounceMs = value;
          await this.plugin.saveSettings();
        })
        .setDynamicTooltip());

    new Setting(containerEl)
      .setName('Fallback classification')
      .setDesc('Used when OpenRouter is unavailable and heuristics are inconclusive.')
      .addDropdown((dropdown) => dropdown
        .addOption('article', 'Article')
        .addOption('product', 'Product')
        .setValue(this.plugin.settings.classificationFallback)
        .onChange(async (value) => {
          this.plugin.settings.classificationFallback = value;
          await this.plugin.saveSettings();
        }));
  }
}

module.exports = DailyLinkClipperPlugin;

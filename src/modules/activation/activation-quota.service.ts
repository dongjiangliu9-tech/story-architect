import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export type ActivationModelKind = 'gemini' | 'deepseek';

interface ActivationUsage {
  geminiUsed: number;
  deepseekUsed: number;
  disabled?: boolean;
}

interface ActivationStore {
  resetVersion?: string;
  codes: Record<string, ActivationUsage>;
}

@Injectable()
export class ActivationQuotaService {
  private readonly geminiLimit = Number(process.env.ACTIVATION_GEMINI_LIMIT || 100);
  private readonly deepseekLimit = Number(process.env.ACTIVATION_DEEPSEEK_LIMIT || 200);
  private readonly storePath =
    process.env.ACTIVATION_STORE_PATH ||
    path.join(process.cwd(), 'data', 'activation-usage.json');

  validateAndConsume(rawCode: string | undefined, model: ActivationModelKind) {
    const code = this.normalizeCode(rawCode);
    const configuredCodes = this.getConfiguredCodes();

    if (configuredCodes.length === 0) {
      return undefined;
    }

    if (!code || !configuredCodes.includes(code)) {
      throw new UnauthorizedException('请输入有效激活码后再调用AI功能');
    }

    const store = this.loadStore();
    this.applyRemoteResets(store, configuredCodes);
    this.ensureConfiguredCodes(store, configuredCodes);

    const usage = store.codes[code];
    if (!usage || usage.disabled) {
      throw new ForbiddenException('该激活码已熔断，请联系管理员重新激活');
    }

    const limit = this.getLimit(model);
    const usedKey = this.getUsedKey(model);
    if (usage[usedKey] >= limit) {
      usage.disabled = true;
      this.saveStore(store);
      throw new ForbiddenException(`该激活码的${model === 'gemini' ? 'Gemini' : 'DeepSeek V4'}额度已用完，已熔断`);
    }

    usage[usedKey] += 1;

    if (usage.geminiUsed >= this.geminiLimit && usage.deepseekUsed >= this.deepseekLimit) {
      usage.disabled = true;
    }

    this.saveStore(store);
    return code;
  }

  refund(rawCode: string | undefined, model: ActivationModelKind) {
    const code = this.normalizeCode(rawCode);
    if (!code || this.getConfiguredCodes().length === 0) return;

    const store = this.loadStore();
    const usage = store.codes[code];
    if (!usage) return;

    const usedKey = this.getUsedKey(model);
    usage[usedKey] = Math.max(0, usage[usedKey] - 1);
    if (usage.geminiUsed < this.geminiLimit || usage.deepseekUsed < this.deepseekLimit) {
      usage.disabled = false;
    }
    this.saveStore(store);
  }

  getStatus(rawCode: string | undefined) {
    const code = this.normalizeCode(rawCode);
    const configuredCodes = this.getConfiguredCodes();

    if (configuredCodes.length === 0) {
      return {
        enabled: false,
        code: '',
        gemini: { used: 0, limit: this.geminiLimit, remaining: this.geminiLimit },
        deepseek: { used: 0, limit: this.deepseekLimit, remaining: this.deepseekLimit },
        disabled: false,
      };
    }

    if (!code || !configuredCodes.includes(code)) {
      throw new UnauthorizedException('请输入有效激活码后再查看余额');
    }

    const store = this.loadStore();
    this.applyRemoteResets(store, configuredCodes);
    this.ensureConfiguredCodes(store, configuredCodes);
    this.saveStore(store);

    const usage = store.codes[code];
    return {
      enabled: true,
      code,
      gemini: {
        used: usage.geminiUsed,
        limit: this.geminiLimit,
        remaining: Math.max(0, this.geminiLimit - usage.geminiUsed),
      },
      deepseek: {
        used: usage.deepseekUsed,
        limit: this.deepseekLimit,
        remaining: Math.max(0, this.deepseekLimit - usage.deepseekUsed),
      },
      disabled: !!usage.disabled,
    };
  }

  private getConfiguredCodes() {
    return (process.env.ACTIVATION_CODES || '')
      .split(',')
      .map((item) => this.normalizeCode(item))
      .filter(Boolean);
  }

  private normalizeCode(code?: string) {
    return (code || '').trim().toUpperCase();
  }

  private getLimit(model: ActivationModelKind) {
    return model === 'deepseek' ? this.deepseekLimit : this.geminiLimit;
  }

  private getUsedKey(model: ActivationModelKind): 'geminiUsed' | 'deepseekUsed' {
    return model === 'deepseek' ? 'deepseekUsed' : 'geminiUsed';
  }

  private emptyUsage(): ActivationUsage {
    return { geminiUsed: 0, deepseekUsed: 0, disabled: false };
  }

  private ensureConfiguredCodes(store: ActivationStore, configuredCodes: string[]) {
    for (const code of configuredCodes) {
      store.codes[code] = {
        ...this.emptyUsage(),
        ...(store.codes[code] || {}),
      };
    }
  }

  private applyRemoteResets(store: ActivationStore, configuredCodes: string[]) {
    const resetVersion = (process.env.ACTIVATION_RESET_VERSION || '').trim();
    const resetCodes = (process.env.ACTIVATION_RESET_CODES || '')
      .split(',')
      .map((item) => this.normalizeCode(item))
      .filter(Boolean);

    if (!resetVersion || resetCodes.length === 0 || store.resetVersion === resetVersion) {
      return;
    }

    const resetAll = resetCodes.includes('*');
    const resetSet = new Set(resetCodes);
    for (const code of configuredCodes) {
      if (resetAll || resetSet.has(code)) {
        store.codes[code] = this.emptyUsage();
      }
    }
    store.resetVersion = resetVersion;
  }

  private loadStore(): ActivationStore {
    try {
      const raw = fs.readFileSync(this.storePath, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        resetVersion: typeof parsed.resetVersion === 'string' ? parsed.resetVersion : undefined,
        codes: parsed.codes && typeof parsed.codes === 'object' ? parsed.codes : {},
      };
    } catch {
      return { codes: {} };
    }
  }

  private saveStore(store: ActivationStore) {
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    const tempPath = `${this.storePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(store, null, 2));
    fs.renameSync(tempPath, this.storePath);
  }
}

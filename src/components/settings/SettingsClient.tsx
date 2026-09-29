'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { useI18n } from '@/components/providers/I18nProvider';
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Modal,
  SectionTitle,
  Spinner,
  Switch,
  Tabs,
  Textarea,
} from '@/components/ui/primitives';
import { Dropdown } from '@/components/ui/Dropdown';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/client/api';
import { resolveModelIdentity } from '@/lib/ai/model-icons';
import type { ProviderPreset } from '@/lib/ai/presets';
import type { BatchSupport, ContextStrategy, GenScene, ProviderConfig, ProviderProtocol } from '@/lib/types';

/** 全局设置：模型接入与 API 管理、基础规则、通用偏好。 */

interface ProvidersPayload {
  providers: ProviderConfig[];
  presets: ProviderPreset[];
  sceneProviders: Partial<Record<GenScene, string>>;
}

interface BaseRuleItem {
  id: number;
  slot: string;
  title: string;
  kind: string;
  content: string;
  description: string;
}

const SCENES: GenScene[] = ['chapter', 'outline', 'character', 'encyclopedia', 'chat'];

interface ProviderFormState {
  id?: string;
  name: string;
  baseUrl: string;
  model: string;
  protocol: ProviderProtocol;
  thinking: boolean;
  batch: BatchSupport | 'auto';
  apiKey: string;
  temperature: number;
  maxTokens: number;
  topP: number;
  stream: boolean;
  maxRetries: number;
  timeoutMs: number;
}

const EMPTY_PROVIDER: ProviderFormState = {
  name: '',
  baseUrl: '',
  model: '',
  protocol: 'openai',
  thinking: false,
  batch: 'auto',
  apiKey: '',
  temperature: 0.85,
  maxTokens: 4096,
  topP: 0.95,
  stream: true,
  maxRetries: 2,
  timeoutMs: 120000,
};

export interface SettingsInitial {
  providers: ProvidersPayload;
  settings: Record<string, string>;
  fts: boolean;
}

export function SettingsClient({ initial }: { initial: SettingsInitial }) {
  const { t } = useI18n();
  const toast = useToast();
  const [tab, setTab] = useState<'models' | 'rules' | 'general'>('models');
  const [providers, setProviders] = useState<ProvidersPayload>(initial.providers);
  const [settings, setSettings] = useState<Record<string, string>>(initial.settings);
  const [form, setForm] = useState<ProviderFormState | null>(null);
  const [testing, setTesting] = useState('');
  const [savingProvider, setSavingProvider] = useState(false);

  /** 供应商相关的改动都会回传完整列表，直接替换状态即可。 */
  const load = useCallback(async () => {
    const providerData = await api.get<ProvidersPayload>('/api/providers');
    setProviders(providerData);
  }, []);

  const patchSettings = async (patch: Record<string, string | number | boolean>) => {
    try {
      const data = await api.patch<{ settings: Record<string, string> }>('/api/settings', patch);
      setSettings(data.settings);
    } catch (error) {
      toast.push(error instanceof Error ? error.message : t('common.error'), 'error');
    }
  };

  const saveProvider = async () => {
    if (!form) return;
    if (!form.name.trim() || !form.baseUrl.trim() || !form.model.trim()) {
      toast.push(t('error.invalidInput'), 'error');
      return;
    }
    setSavingProvider(true);
    try {
      await api.post('/api/providers', { action: 'save', ...form });
      setForm(null);
      await load();
      toast.push(t('settings.providerSaved'), 'success');
    } catch (error) {
      toast.push(error instanceof Error ? error.message : t('common.error'), 'error');
    } finally {
      setSavingProvider(false);
    }
  };

  const testProvider = async (id: string) => {
    setTesting(id);
    try {
      const result = await api.post<{ ok: boolean; message: string; latency: number }>('/api/providers', {
        action: 'test',
        providerId: id,
      });
      toast.push(
        `${result.ok ? t('settings.testOk') : t('settings.testFail')}：${result.message}（${result.latency}ms）`,
        result.ok ? 'success' : 'error',
      );
    } catch (error) {
      toast.push(error instanceof Error ? error.message : t('common.error'), 'error');
    } finally {
      setTesting('');
    }
  };

  const removeProvider = async (provider: ProviderConfig) => {
    if (!window.confirm(t('settings.deleteProviderConfirm'))) return;
    try {
      await api.delete(`/api/providers?id=${encodeURIComponent(provider.id)}`);
      await load();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : t('common.error'), 'error');
    }
  };

  const setDefault = async (id: string) => {
    try {
      await api.post('/api/providers', { action: 'setDefault', providerId: id });
      await load();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : t('common.error'), 'error');
    }
  };

  const setSceneProvider = async (scene: GenScene, providerId: string) => {
    try {
      await api.post('/api/providers', { action: 'setScene', scene, providerId });
      await load();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : t('common.error'), 'error');
    }
  };

  return (
    <div className="mx-auto w-[80%] min-w-[min(80%,64rem)] py-10">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('settings.title')}</h1>
          <p className="mt-1 text-xs text-muted">{t('app.tagline')}</p>
        </div>
        <Link href="/">
          <Button variant="outline" icon="fa-chevron-left">
            {t('nav.shelf')}
          </Button>
        </Link>
      </header>

      <Tabs
        value={tab}
        onChange={setTab}
        className="mb-5"
        items={[
          { value: 'models', label: t('settings.models'), icon: 'fa-microchip', count: providers.providers.length },
          { value: 'rules', label: t('settings.rules'), icon: 'fa-scroll' },
          { value: 'general', label: t('settings.general'), icon: 'fa-sliders' },
        ]}
      />

      {tab === 'models' ? (
        <div className="flex flex-col gap-5">
          <Card>
            <SectionTitle
              icon="fa-plug"
              title={t('settings.models')}
              hint={t('settings.apiKeys')}
              actions={
                <Button variant="primary" icon="fa-plus" onClick={() => setForm({ ...EMPTY_PROVIDER })}>
                  {t('settings.addProvider')}
                </Button>
              }
            />
            {providers.providers.length === 0 ? (
              <p className="text-xs text-faint">{t('settings.noProviders')}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {providers.providers.map((provider) => (
                  <li
                    key={provider.id}
                    className="flex flex-wrap items-center gap-3 rounded-2xl border border-line-soft bg-ink-soft/40 px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{provider.name}</span>
                        {provider.isDefault ? <Badge tone="accent">{t('settings.default')}</Badge> : null}
                        {provider.hasKey ? (
                          <Badge tone="muted">{provider.keyMask}</Badge>
                        ) : (
                          <Badge tone="danger">{t('settings.apiKey')}</Badge>
                        )}
                      </div>
                      <p className="mt-1 truncate font-mono text-[11px] text-faint">
                        {provider.model} · {provider.baseUrl}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {provider.stream ? <Badge tone="muted">{t('settings.stream')}</Badge> : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        icon="fa-satellite-dish"
                        loading={testing === provider.id}
                        onClick={() => testProvider(provider.id)}
                      >
                        {t('settings.testConnection')}
                      </Button>
                      {!provider.isDefault ? (
                        <Button variant="ghost" size="sm" icon="fa-check" onClick={() => setDefault(provider.id)}>
                          {t('settings.isDefault')}
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          setForm({
                            id: provider.id,
                            name: provider.name,
                            baseUrl: provider.baseUrl,
                            model: provider.model,
                            protocol: provider.protocol,
                            thinking: provider.thinking,
                            batch: provider.batch,
                            apiKey: '',
                            temperature: provider.temperature,
                            maxTokens: provider.maxTokens,
                            topP: provider.topP,
                            stream: provider.stream,
                            maxRetries: provider.maxRetries,
                            timeoutMs: provider.timeoutMs,
                          })
                        }
                        aria-label={t('common.edit')}
                      >
                        <i className="fa-solid fa-pen" aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeProvider(provider)}
                        aria-label={t('common.delete')}
                      >
                        <i className="fa-solid fa-trash-can" aria-hidden />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <SectionTitle icon="fa-bolt" title={t('settings.scene')} hint={t('settings.sceneHint')} />
            <div className="grid gap-3 sm:grid-cols-2">
              {SCENES.map((scene) => (
                <Field key={scene} label={t(`settings.scene.${scene}`)}>
                  <Dropdown
                    value={providers.sceneProviders[scene] ?? ''}
                    onChange={(value) => setSceneProvider(scene, value)}
                    options={[
                      { value: '', label: t('settings.default'), icon: 'fa-star' },
                      ...providers.providers.map((provider) => ({
                        value: provider.id,
                        label: `${provider.name} · ${provider.model}`,
                        icon: resolveModelIdentity({
                          name: provider.name,
                          baseUrl: provider.baseUrl,
                          model: provider.model,
                        }).icon,
                      })),
                    ]}
                  />
                </Field>
              ))}
            </div>
          </Card>

          <Card>
            <SectionTitle icon="fa-cubes" title={t('settings.preset')} />
            <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3">
              {providers.presets.map((preset) => (
                <div key={preset.id} className="rounded-2xl border border-line-soft bg-ink-soft/40 p-3">
                  <p className="text-sm font-medium">{preset.name}</p>
                  <p className="mt-1 text-[11px] text-muted">{preset.note}</p>
                  <p className="mt-2 truncate font-mono text-[10px] text-faint">{preset.baseUrl}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Badge tone={preset.protocol === 'anthropic' ? 'accent' : 'muted'}>
                      {preset.protocol === 'anthropic' ? 'Anthropic' : 'OpenAI 兼容'}
                    </Badge>
                    <Badge tone={preset.batch === 'none' ? 'muted' : 'accent'}>
                      {preset.batch === 'none' ? t('settings.batchLocal') : t('settings.batchNative')}
                    </Badge>
                    {preset.alternate ? <Badge tone="muted">{t('settings.hasAlternate')}</Badge> : null}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      icon="fa-plus"
                      onClick={() =>
                        setForm({
                          ...EMPTY_PROVIDER,
                          name: preset.name,
                          baseUrl: preset.baseUrl,
                          model: preset.defaultModel,
                          protocol: preset.protocol,
                          batch: preset.batch,
                        })
                      }
                    >
                      {t('common.add')}
                    </Button>
                    {preset.alternate ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon="fa-right-left"
                        onClick={() =>
                          setForm({
                            ...EMPTY_PROVIDER,
                            name: `${preset.name}（Anthropic）`,
                            baseUrl: preset.alternate?.url ?? '',
                            model: preset.alternate?.defaultModel ?? preset.defaultModel,
                            protocol: 'anthropic',
                            batch: 'anthropic',
                          })
                        }
                      >
                        {t('settings.useAlternate')}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      ) : tab === 'rules' ? (
        <RulesSettings t={t} />
      ) : (
        <div className="flex flex-col gap-5">
          <Card>
            <SectionTitle icon="fa-language" title={t('settings.language')} hint={t('settings.languageHint')} />
            <div className="flex flex-wrap gap-2">
              <Badge tone="accent">中文</Badge>
              <Badge tone="muted">en.ts</Badge>
            </div>
          </Card>

          <Card>
            <SectionTitle icon="fa-text-height" title={t('settings.theme')} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={`${t('settings.fontSize')} ${settings.fontSize ?? 18}px`}>
                <input
                  type="range"
                  min={14}
                  max={30}
                  value={Number(settings.fontSize ?? 18)}
                  onChange={(event) => void patchSettings({ fontSize: Number(event.target.value) })}
                  className="w-full cursor-pointer"
                />
              </Field>
              <Field label={`${t('settings.lineHeight')} ${settings.lineHeight ?? 1.9}`}>
                <input
                  type="range"
                  min={1.4}
                  max={2.6}
                  step={0.1}
                  value={Number(settings.lineHeight ?? 1.9)}
                  onChange={(event) => void patchSettings({ lineHeight: Number(event.target.value) })}
                  className="w-full cursor-pointer"
                />
              </Field>
              <Field label={t('settings.dialogueHighlight')} hint={t('settings.dialogueHighlightHint')}>
                <Switch
                  checked={settings.dialogueHighlight === '1'}
                  onChange={(next) => void patchSettings({ dialogueHighlight: next ? '1' : '0' })}
                />
              </Field>
              <Field label={t('settings.autoSave')}>
                <Switch
                  checked={settings.autoSave === '1'}
                  onChange={(next) => void patchSettings({ autoSave: next ? '1' : '0' })}
                />
              </Field>
            </div>
          </Card>

          <Card>
            <SectionTitle icon="fa-layer-group" title={t('settings.contextStrategy')} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('settings.contextStrategy')}>
                <Dropdown
                  value={settings.contextStrategy ?? 'balanced'}
                  onChange={(value) => void patchSettings({ contextStrategy: value })}
                  options={(['balanced', 'quality', 'frugal'] as ContextStrategy[]).map((strategy) => ({
                    value: strategy,
                    label: t(`settings.strategy.${strategy}`),
                  }))}
                />
              </Field>
              <Field label={t('settings.tokenLimit')}>
                <Input
                  type="number"
                  value={settings.tokenBudget ?? '60000'}
                  onChange={(event) => void patchSettings({ tokenBudget: Number(event.target.value) })}
                />
              </Field>
            </div>
          </Card>
        </div>
      )}

      <Modal
        open={Boolean(form)}
        title={form?.id ? t('common.edit') : t('settings.addProvider')}
        onClose={() => setForm(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setForm(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" icon="fa-check" loading={savingProvider} onClick={saveProvider}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        {form ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('settings.providerName')}>
              <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </Field>
            <Field label={t('settings.model')}>
              <Input value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} />
            </Field>
            <Field label={t('settings.protocol')} hint={t('settings.protocolHint')}>
              <Dropdown
                value={form.protocol}
                onChange={(value) => setForm({ ...form, protocol: value as ProviderProtocol })}
                options={[
                  { value: 'openai', label: 'OpenAI 兼容', icon: 'fa-plug', hint: '/chat/completions' },
                  { value: 'anthropic', label: 'Anthropic', icon: 'fa-feather', hint: '/messages' },
                ]}
              />
            </Field>
            <Field label={t('settings.baseUrl')} className="sm:col-span-2">
              <Input value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} />
            </Field>
            <div className="sm:col-span-2">
              <label className="flex cursor-pointer items-start gap-2.5 rounded-2xl border border-line-soft bg-ink-soft/40 p-3">
                <input
                  type="checkbox"
                  checked={form.thinking}
                  onChange={(event) => setForm({ ...form, thinking: event.target.checked })}
                  className="mt-0.5 h-4 w-4 cursor-pointer accent-[var(--color-accent)]"
                />
                <span className="min-w-0">
                  <span className="block text-sm">{t('settings.thinking')}</span>
                  <span className="mt-0.5 block text-[11px] text-muted">{t('settings.thinkingHint')}</span>
                </span>
              </label>
            </div>
            <Field label={t('settings.batchCapability')} hint={t('settings.batchCapabilityHint')} className="sm:col-span-2">
              <Dropdown
                value={form.batch}
                onChange={(value) => setForm({ ...form, batch: value as BatchSupport | 'auto' })}
                options={[
                  { value: 'auto', label: t('settings.batch.auto'), icon: 'fa-wand-magic-sparkles' },
                  { value: 'none', label: t('settings.batch.none'), icon: 'fa-server' },
                  { value: 'anthropic', label: t('settings.batch.anthropic'), icon: 'fa-feather' },
                  { value: 'openai', label: t('settings.batch.openai'), icon: 'fa-layer-group' },
                ]}
              />
            </Field>
            <Field
              label={t('settings.apiKey')}
              hint={form.id ? t('settings.apiKeySaved') : undefined}
              className="sm:col-span-2"
            >
              <Input
                type="password"
                value={form.apiKey}
                onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
                placeholder="sk-..."
                autoComplete="off"
              />
            </Field>
            <Field label={`${t('settings.temperature')} ${form.temperature}`}>
              <input
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={form.temperature}
                onChange={(event) => setForm({ ...form, temperature: Number(event.target.value) })}
                className="w-full cursor-pointer"
              />
            </Field>
            <Field label={`${t('settings.topP')} ${form.topP}`}>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={form.topP}
                onChange={(event) => setForm({ ...form, topP: Number(event.target.value) })}
                className="w-full cursor-pointer"
              />
            </Field>
            <Field label={t('settings.maxTokens')}>
              <Input
                type="number"
                value={form.maxTokens}
                onChange={(event) => setForm({ ...form, maxTokens: Number(event.target.value) })}
              />
            </Field>
            <Field label={t('settings.maxRetries')}>
              <Input
                type="number"
                value={form.maxRetries}
                onChange={(event) => setForm({ ...form, maxRetries: Number(event.target.value) })}
              />
            </Field>
            <Field label={t('settings.timeout')}>
              <Input
                type="number"
                value={form.timeoutMs}
                onChange={(event) => setForm({ ...form, timeoutMs: Number(event.target.value) })}
              />
            </Field>
            <Field label={t('settings.stream')}>
              <Switch checked={form.stream} onChange={(next) => setForm({ ...form, stream: next })} />
            </Field>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

/** 基础规则在设置中全局编辑，任意小说都会使用同一份模板。 */
function RulesSettings({ t }: { t: ReturnType<typeof useI18n>['t'] }) {
  const toast = useToast();
  const [baseRules, setBaseRules] = useState<BaseRuleItem[]>([]);
  const [tags, setTags] = useState<{ name: string; purpose: string }[]>([]);
  const [postprocessDoc, setPostprocessDoc] = useState('');
  const [editing, setEditing] = useState<BaseRuleItem | null>(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{
        baseRules: BaseRuleItem[];
        tags: { name: string; purpose: string }[];
        postprocessDoc: string;
      }>('/api/base-rules');
      setBaseRules(data.baseRules);
      setTags(data.tags);
      setPostprocessDoc(data.postprocessDoc);
    } catch (error) {
      toast.push(error instanceof Error ? error.message : t('common.error'), 'error');
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!editing) return;
    try {
      const data = await api.post<{ baseRules: BaseRuleItem[] }>('/api/base-rules', {
        action: 'save',
        slot: editing.slot,
        content,
      });
      setBaseRules(data.baseRules);
      setEditing(null);
      toast.push(t('common.saved'), 'success');
    } catch (error) {
      toast.push(error instanceof Error ? error.message : t('common.error'), 'error');
    }
  };

  const reset = async () => {
    try {
      const data = await api.post<{ baseRules: BaseRuleItem[] }>('/api/base-rules', { action: 'reset' });
      setBaseRules(data.baseRules);
      await load();
      toast.push(t('rules.templateApplied'), 'success');
    } catch (error) {
      toast.push(error instanceof Error ? error.message : t('common.error'), 'error');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <SectionTitle
          icon="fa-scroll"
          title={t('rules.baseTitle')}
          hint={t('rules.baseHint')}
          actions={
            <Button variant="outline" size="sm" icon="fa-rotate-left" onClick={reset}>
              {t('common.reset')}
            </Button>
          }
        />
        <div className="flex flex-col gap-4">
          {baseRules.map((rule) => (
            <div key={rule.slot}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{rule.title}</p>
                  <p className="mt-0.5 text-[11px] text-muted">{rule.description}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  icon="fa-pen"
                  onClick={() => {
                    setEditing(rule);
                    setContent(rule.content);
                  }}
                >
                  {t('common.edit')}
                </Button>
              </div>
              <pre className="max-h-72 overflow-auto rounded-2xl border border-line-soft bg-ink-soft/60 p-3 font-mono text-[11px] whitespace-pre-wrap text-muted">
                {rule.content}
              </pre>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <SectionTitle icon="fa-tags" title={t('rules.tagReference')} />
        <ul className="flex flex-col gap-1.5">
          {tags.map((tag) => (
            <li key={tag.name} className="flex items-start gap-3 rounded-xl px-2 py-1.5 hover:bg-white/5">
              <code className="shrink-0 rounded-md border border-accent/40 px-1.5 py-0.5 font-mono text-[11px] text-accent">
                {`{{${tag.name}}}`}
              </code>
              <span className="text-xs text-muted">{tag.purpose}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <SectionTitle icon="fa-code" title={t('rules.dslReference')} />
        <pre className="max-h-[32rem] overflow-auto rounded-2xl border border-line-soft bg-ink-soft/60 p-4 font-mono text-[11px] whitespace-pre-wrap text-muted">
          {postprocessDoc}
        </pre>
      </Card>

      <Modal
        open={Boolean(editing)}
        title={`${t('common.edit')} · ${editing?.title ?? ''}`}
        onClose={() => setEditing(null)}
        width="max-w-3xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" icon="fa-check" onClick={save}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <Textarea
          rows={22}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          className="font-mono text-xs"
        />
      </Modal>
    </div>
  );
}

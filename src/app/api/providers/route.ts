import {
  deleteProvider,
  getSceneProviders,
  listProviders,
  saveProvider,
  setDefaultProvider,
  setSceneProvider,
} from '@/lib/store/providers';
import { PROVIDER_PRESETS } from '@/lib/ai/presets';
import { testProvider } from '@/lib/ai/client';
import { fail, handleError, ok, readJson } from '@/lib/api/http';
import type { GenScene, ProviderInput } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET() {
  try {
    return ok({ providers: listProviders(), presets: PROVIDER_PRESETS, sceneProviders: getSceneProviders() });
  } catch (error) {
    return handleError(error);
  }
}

interface ProviderBody extends ProviderInput {
  action?: 'save' | 'setDefault' | 'setScene' | 'test';
  scene?: GenScene;
  providerId?: string;
}

export async function POST(request: Request) {
  try {
    const body = await readJson<ProviderBody>(request);
    if (body.action === 'setDefault') {
      if (!body.providerId) return fail('缺少供应商标识');
      setDefaultProvider(body.providerId);
      return ok({ providers: listProviders() });
    }
    if (body.action === 'setScene') {
      if (!body.scene) return fail('缺少场景');
      setSceneProvider(body.scene, body.providerId ?? '');
      return ok({ sceneProviders: getSceneProviders() });
    }
    if (body.action === 'test') {
      const id = body.providerId ?? body.id;
      if (!id) return fail('缺少供应商标识');
      const result = await testProvider(id);
      return ok(result);
    }
    if (!body.name?.trim()) return fail('供应商名称不能为空');
    if (!body.baseUrl?.trim()) return fail('API 地址不能为空');
    if (!body.model?.trim()) return fail('模型名称不能为空');
    const provider = saveProvider(body);
    return ok({ provider, providers: listProviders() });
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return fail('缺少供应商标识');
    deleteProvider(id);
    return ok({ providers: listProviders() });
  } catch (error) {
    return handleError(error);
  }
}

import { SettingsClient } from '@/components/settings/SettingsClient';
import { PROVIDER_PRESETS } from '@/lib/ai/presets';
import { isFtsEnabled } from '@/lib/db';
import { getAllSettings, getSceneProviders, listProviders } from '@/lib/store/providers';

export const dynamic = 'force-dynamic';

/** 全局设置。供应商列表与配置在服务端读好，改动后由接口回传最新状态。 */
export default function SettingsPage() {
  return (
    <SettingsClient
      initial={{
        providers: {
          providers: listProviders(),
          presets: PROVIDER_PRESETS,
          sceneProviders: getSceneProviders(),
        },
        settings: getAllSettings(),
        fts: isFtsEnabled(),
      }}
    />
  );
}

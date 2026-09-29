import { advanceBatches, cancelJob, retryFailed, startBatch, batchCandidateRefs } from '@/lib/ai/batch';
import { resolveBatchSupport } from '@/lib/ai/presets';
import { currentModelMeta } from '@/lib/ai/pipeline';
import { fail, handleError, ok, readJson, routeParams } from '@/lib/api/http';
import { deleteJob, getJob, listJobs, getJobDetail } from '@/lib/store/batches';
import { listChapters } from '@/lib/store/chapters';
import { resolveProviderForScene } from '@/lib/store/providers';
import { chapterLabel } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface Context {
  params: Promise<{ novelId: string }>;
}

/**
 * 批量推理。
 * GET 除了取任务列表，还会顺带推进未完成的任务——客户端轮询即调度，
 * 因此不需要额外的常驻进程，重启服务后任务也能继续。
 */
export async function GET(_request: Request, context: Context) {
  try {
    const { novelId } = await routeParams(context);
    const resolved = resolveProviderForScene('chapter');
    const support = resolved ? resolveBatchSupport(resolved.config.protocol, resolved.config.baseUrl, resolved.config.batch) : 'none';
    return ok({
      jobs: await advanceBatches(novelId),
      candidates: listChapters(novelId)
        .filter((chapter) => !chapter.isDraft)
        .map((chapter) => ({
          ref: chapter.ref,
          indexNo: chapter.indexNo,
          title: chapterLabel(chapter.indexNo, chapter.title),
          status: chapter.status,
          wordCount: chapter.wordCount,
        })),
      support,
      model: currentModelMeta('chapter'),
    });
  } catch (error) {
    return handleError(error);
  }
}

interface BatchBody {
  action?: 'create' | 'retry' | 'cancel';
  jobId?: string;
  refs?: string[];
  mode?: 'auto' | 'provider' | 'local';
  direction?: string;
  concurrency?: number;
  thinking?: boolean;
  maxTokens?: number;
}

export async function POST(request: Request, context: Context) {
  try {
    const { novelId } = await routeParams(context);
    const body = await readJson<BatchBody>(request);

    if (body.action === 'retry') {
      if (!body.jobId) return fail('缺少任务编号');
      return ok({ job: retryFailed(body.jobId) });
    }

    if (body.action === 'cancel') {
      if (!body.jobId) return fail('缺少任务编号');
      cancelJob(body.jobId);
      return ok({ job: getJobDetail(body.jobId) });
    }

    const refs = (body.refs ?? []).filter((ref) => batchCandidateRefs(novelId).includes(ref));
    if (refs.length === 0) return fail('请先选择要生成的章节');
    if (refs.length > 500) return fail('单次批量最多 500 章');

    const job = startBatch({
      novelId,
      refs,
      options: {
        mode: body.mode ?? 'auto',
        direction: body.direction ?? '',
        concurrency: body.concurrency ?? 1,
        thinking: body.thinking,
        maxTokens: body.maxTokens,
      },
    });
    return ok({ job: getJobDetail(job.id) }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const { novelId } = await routeParams(context);
    const jobId = new URL(request.url).searchParams.get('jobId');
    if (!jobId) return fail('缺少任务编号');
    const job = getJob(jobId);
    if (!job || job.novelId !== novelId) return fail('任务不存在', 404);
    if (job.status === 'running' || job.status === 'pending') cancelJob(jobId);
    deleteJob(jobId);
    return ok({ jobs: listJobs(novelId, 10).map((item) => getJobDetail(item.id)) });
  } catch (error) {
    return handleError(error);
  }
}

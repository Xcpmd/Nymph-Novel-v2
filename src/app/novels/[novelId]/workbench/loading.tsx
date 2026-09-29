import { PageSkeleton } from '@/components/ui/Loading';

/** 路由级加载占位，数据在服务端出，这里只在等待时显示骨架。 */
export default function Loading() {
  return <PageSkeleton cards={3} />;
}

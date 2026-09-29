import Link from 'next/link';

import { Button, EmptyState } from '@/components/ui/primitives';

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-screen w-[80%] items-center justify-center">
      <EmptyState
        icon="fa-circle-question"
        title="页面不存在"
        hint="可能是小说已被删除，或者链接不正确"
        action={
          <Link href="/">
            <Button variant="primary" icon="fa-chevron-left">
              返回书架
            </Button>
          </Link>
        }
      />
    </div>
  );
}

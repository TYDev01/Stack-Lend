import * as React from "react";

import { cn } from "../../lib/utils";

function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-xs font-medium text-neutral-700 shadow-sm",
        className
      )}
      {...props}
    />
  );
}

export { Badge };

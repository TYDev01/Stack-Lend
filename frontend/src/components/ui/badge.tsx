import * as React from "react";

import { cn } from "../../lib/utils";

function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-200 shadow-sm shadow-black/40",
        className
      )}
      {...props}
    />
  );
}

export { Badge };

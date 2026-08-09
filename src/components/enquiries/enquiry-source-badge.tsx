import { Badge } from '@/components/ui/badge';
import { EnquirySource } from '@/api/enquiries.api';

/**
 * Website provenance badge — mirrors `enquiry-status-badge.tsx`'s pattern (a shadcn `Badge`
 * with fixed color classes). Renders ONLY for `source: 'website'`.
 *
 * `source` is `undefined` on every enquiry created before this field existed — that means
 * "predates the field", a different claim from "a staff member created this" — so an absent
 * source renders NOTHING, never a "Staff" badge. `source: 'staff'` is not currently written
 * anywhere either (see `EnquiryResponse`'s own comment in the API), and the owner only asked
 * for website-originated enquiries to be visibly flagged, so it renders nothing too: there is
 * no meaningful claim to assert about it today.
 */
export function EnquirySourceBadge({ source }: { source?: EnquirySource }) {
  if (source !== 'website') return null;
  return (
    <Badge className="border-violet-200 bg-violet-100 text-violet-800 hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300">
      Website
    </Badge>
  );
}

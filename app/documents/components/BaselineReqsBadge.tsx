'use client'

/**
 * BaselineReqsBadge
 *
 * Pure display component — receives pre-fetched BaselineReqs reference data
 * from the server page component (fetched with a 5-minute cache so it doesn't
 * add latency on every page load).
 *
 * Renders nothing if there are no references.
 */

import { useState } from 'react'
import { ExternalLink, ChevronDown, ChevronUp } from 'lucide-react'
import type { BaselineReqsLinksResult } from '@/lib/integrations/baselinereqs'

// Inline the BaselineReqs icon SVG — avoids an extra network request and
// ensures it renders immediately without a flash of the fallback icon.
function BaselineReqsIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 17.487781 14.525135"
      className={className}
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g transform="translate(-2.445428,-4.2131945)">
        <path
          fill="#dc2626"
          d="m 15.467961,7.4864931 -2.099223,2.3599689 4.050087,3.578462 a 0.30614348,0.30614348 155.93214 0 0 0.508842,-0.227273 l 0.03413,-4.8641081 a 0.51858676,0.51858676 49.775826 0 0 -0.436112,-0.515627 z"
        />
        <path
          fill="#dc2626"
          d="M 11.101576,11.269514 15.85317,6.1672175 a 0.10114652,0.10114652 66.482172 0 0 -0.07402,-0.1700789 l -5.06286,-2.343e-4 A 1.3019397,1.3019397 157.5444 0 0 9.7970096,6.3768506 L 7.2566834,8.9095499 8.0009615,8.9506137 A 1.5363371,1.5363371 22.463026 0 1 8.939707,9.3387453 Z"
        />
        <path
          fill="#1e293b"
          d="m 8.4375,16.89375 5.164163,-5.195502 a 0.61372118,0.61372118 178.42879 0 1 0.846183,-0.02321 l 2.525166,2.276136 a 0.43859335,0.43859335 88.811511 0 1 0.01326,0.639101 l -1.898424,1.859586 a 1.600884,1.600884 157.8653 0 1 -1.124106,0.457245 z"
        />
        <path
          fill="#1e293b"
          d="m 8.1085586,16.141798 3.2962004,-3.203783 a 0.34229762,0.34229762 89.416227 0 0 -0.0051,-0.495726 L 8.5100588,9.7459615 A 1.3735631,1.3735631 21.420791 0 0 7.5687513,9.3766731 l -2.8615602,0.0088 A 0.65092782,0.65092782 134.54924 0 0 4.0583182,10.044642 l 0.037155,2.93521 a 0.82652486,0.82652486 65.874329 0 0 0.2683444,0.599171 l 2.8145168,2.57667 a 0.67788926,0.67788926 179.14423 0 0 0.9302246,-0.01389 z"
        />
      </g>
    </svg>
  )
}

interface BaselineReqsBadgeProps {
  refs: BaselineReqsLinksResult | null
}

export default function BaselineReqsBadge({ refs }: BaselineReqsBadgeProps) {
  const [expanded, setExpanded] = useState(false)

  if (!refs?.linked) return null

  return (
    <div className="mt-2">
      {/* ── Pill button ──────────────────────────────────────────────── */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-800 hover:bg-red-100 transition-colors"
      >
        <BaselineReqsIcon className="h-3 w-3 flex-shrink-0" />
        <span>
          {refs.count} Requirement{refs.count === 1 ? '' : 's'} in BaselineReqs
        </span>
        {expanded
          ? <ChevronUp className="h-3 w-3 text-red-400" />
          : <ChevronDown className="h-3 w-3 text-red-400" />
        }
      </button>

      {/* ── Expanded reference list ───────────────────────────────────── */}
      {expanded && refs.references.length > 0 && (
        <div className="mt-1.5 rounded-md border border-red-100 bg-white p-3 text-sm space-y-2 shadow-sm">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Linked Requirements
          </p>
          <ul className="space-y-2">
            {refs.references.map((ref) => (
              <li key={ref.attachment_id} className="flex items-start gap-2">
                <ExternalLink className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-red-400" />
                <a
                  href={ref.reqs_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-slate-800 leading-snug hover:text-red-700 transition-colors group"
                >
                  <span className="font-medium text-slate-900 group-hover:text-red-700">{ref.item_req_number}</span>
                  <span className="text-slate-500 mx-1">—</span>
                  {ref.item_title}
                  <span className="ml-1.5 text-xs text-slate-400">
                    {ref.project_name}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

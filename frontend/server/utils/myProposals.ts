import {
  emptyProposalCounts,
  type Proposal,
  type ProposalCounts,
} from "~~/shared/proposals";

/** How far back one person's own record is read. The largest human revision
 * count in production is 94 and the whole human corpus is 1,814 across ten
 * uids, so this covers every real contributor with room to spare while capping
 * what a pipeline account could pull by opening its profile. */
export const MINE_SCAN_CAP = 300;

/** Proposals by state, for the summary chips. */
export function countProposals(proposals: Proposal[]): ProposalCounts {
  return proposals.reduce<ProposalCounts>((acc, row) => {
    acc[row.status] += 1;
    return acc;
  }, emptyProposalCounts());
}

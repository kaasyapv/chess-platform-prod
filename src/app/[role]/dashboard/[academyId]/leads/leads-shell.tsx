"use client";

/* Leads + TeleCRM live under one sidebar item now - Pipeline is the original
 * leads board, TeleCRM (native clone + Path A integration) is a tab beside
 * it rather than its own route. Both children keep their own internals
 * untouched; this shell only owns the outer title + tab switch. */

import { useState } from "react";
import { PageHeader, SegmentedTabs } from "@/components/ui";
import type { Profile } from "@/lib/auth";
import { LeadsClient } from "./leads-client";
import { TeleCrmClient, type TeleCrmPerms } from "../telecrm/telecrm-client";

const TABS = ["Pipeline", "TeleCRM"];

export function LeadsShell({ me, perms }: { me: Profile; perms: TeleCrmPerms }) {
  const [tab, setTab] = useState(TABS[0]);

  return (
    <div>
      <PageHeader title="Leads" />
      <div className="mb-4">
        <SegmentedTabs tabs={TABS} active={tab} onChange={setTab} />
      </div>
      {tab === "Pipeline" && <LeadsClient me={me} hideHeader />}
      {tab === "TeleCRM" && <TeleCrmClient me={me} perms={perms} hideHeader />}
    </div>
  );
}

import { requireUser } from "@/lib/auth";
import { ADMIN_ROLES } from "@/lib/permissions";
import { fmtDate } from "@/lib/format";
import { PAYABLE_ON, termsAge } from "@/lib/vendors";
import { packRulesLine } from "@/lib/pack";
import { listVendors, vendorCoverage } from "@/server/vendors";
import { confirmVendorTermsAction, setVendorActiveAction } from "@/server/vendor-actions";
import { VendorForm, EditVendor } from "./forms";
import { Button, Card, CardHeader, Chip, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";
import { IconPartners } from "@/components/icons";

export const metadata = { title: "Vendors and routes" };

/**
 * The roads Medcity reaches universities by. A vendor here is the terms and
 * the colour; the routes themselves are recorded per course, on the course.
 */
export default async function VendorsPage() {
  await requireUser([...ADMIN_ROLES]);
  const rows = await listVendors();
  const coverage = await vendorCoverage();

  return (
    <>
      <PageHeader
        title="Vendors and routes"
        subtitle="Who an application can be sent through, what each pays, and the colour that says which on every screen."
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card>
          {rows.length === 0 ? (
            <EmptyState icon={<IconPartners />} title="No vendors yet">
              Add Medcity's own agreements as one vendor, and each aggregator as its own. A course reaches a vendor through a route, recorded on the course.
            </EmptyState>
          ) : (
            <Table tableClassName="min-w-[760px]">
              <thead>
                <tr>
                  <Th>Vendor</Th>
                  <Th>Terms</Th>
                  <Th>Live routes</Th>
                  <Th>Reaches</Th>
                  <Th>Confirmed</Th>
                  <Th><span className="sr-only">Actions</span></Th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ vendor, routes, allRoutes }) => {
                  const age = termsAge(vendor.termsConfirmedAt);
                  const reach = coverage.get(vendor.id);
                  return (
                    <tr key={vendor.id} className="align-top">
                      <Td>
                        <div className="flex items-center gap-2">
                          <span className="size-3 shrink-0 rounded-sm" style={{ background: vendor.colour }} aria-hidden="true" />
                          <span className="font-semibold text-ink">{vendor.code}</span>
                          <span className="text-ink">{vendor.name}</span>
                          {vendor.isDirect && <Chip tone="ok">Our own agreement</Chip>}
                          {!vendor.active && <Chip tone="warn">Paused</Chip>}
                        </div>
                        {vendor.contactName && <p className="mt-0.5 text-xs text-muted">{vendor.contactName}{vendor.contactEmail ? ` · ${vendor.contactEmail}` : ""}</p>}
                        <p className="mt-0.5 text-xs text-muted">Packs: {packRulesLine({ shape: vendor.packShape, naming: vendor.packNaming, limitMb: vendor.packLimitMb })}</p>
                        <EditVendor vendor={{ ...vendor, payableOn: vendor.payableOn as string }} />
                      </Td>
                      <Td className="text-[13px]">
                        Paid once {PAYABLE_ON[vendor.payableOn as keyof typeof PAYABLE_ON]},<br />
                        then within {vendor.daysToPay} days, in {vendor.currency}
                      </Td>
                      <Td className="tabular">
                        {routes.toLocaleString("en-IN")}
                        {allRoutes > routes && <span className="text-muted"> of {allRoutes.toLocaleString("en-IN")}</span>}
                      </Td>
                      <Td className="text-[13px]">
                        {reach ? `${reach.programs.toLocaleString("en-IN")} live courses in ${reach.countries} ${reach.countries === 1 ? "country" : "countries"}` : <span className="text-muted">No live courses yet</span>}
                      </Td>
                      <Td className="text-[13px]">
                        {vendor.termsConfirmedAt ? fmtDate(vendor.termsConfirmedAt) : <span className="text-muted">Never</span>}
                        {age.stale && <p className="text-xs font-medium text-amber-700">{vendor.termsConfirmedAt ? "Older than six months" : "Not confirmed yet"}</p>}
                      </Td>
                      <Td>
                        <div className="flex flex-col gap-1.5">
                          <form action={confirmVendorTermsAction}>
                            <input type="hidden" name="vendorId" value={vendor.id} />
                            <Button size="sm" variant="secondary">Terms checked today</Button>
                          </form>
                          <form action={setVendorActiveAction}>
                            <input type="hidden" name="vendorId" value={vendor.id} />
                            <input type="hidden" name="active" value={vendor.active ? "0" : "1"} />
                            <Button size="sm" variant="quiet">{vendor.active ? "Pause" : "Bring back"}</Button>
                          </form>
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
        <Card className="h-fit p-4">
          <CardHeader title="Add a vendor" subtitle="Medcity's own agreements count as one, so a direct application carries a route like any other." />
          <VendorForm />
        </Card>
      </div>
    </>
  );
}

import { useMemo, useState } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Building2, Mail, Phone, MapPin, Link as LinkIcon, CreditCard, Search } from "lucide-react";
import { RENTAL_COMPANIES } from "@/data/rental-companies";

/**
 * Rental Companies — landlord / management / vendor directory built from the
 * June 2026 email harvest. One contact card per company: who to call, where
 * to pay, portal, and which properties they cover. Read-only reference so an
 * operator can answer "who do I contact / what am I paying for" fast.
 */
export default function RentalCompaniesPage() {
  const [q, setQ] = useState("");
  const companies = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = [...RENTAL_COMPANIES].sort((a, b) => a.company.localeCompare(b.company));
    if (!needle) return list;
    return list.filter((c) =>
      [c.company, c.legalName, c.mailingAddress, c.notes, ...c.propertiesServed, ...c.contacts.map((x) => x.name + x.email)]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [q]);

  return (
    <MainLayout>
      <div className="p-8 max-w-7xl mx-auto space-y-6">
        <PageHeader
          title="Rental Companies"
          description="Landlords, property managers, and housing vendors — contacts, payment, and which properties they cover."
          actions={
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search companies, contacts, properties…"
                className="w-72 pl-8"
              />
            </div>
          }
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {companies.map((c) => (
            <Card key={c.company} className="flex flex-col">
              <CardContent className="flex flex-1 flex-col gap-3 p-5">
                <div className="flex items-start gap-2">
                  <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <h3 className="font-semibold leading-tight">{c.company}</h3>
                    {c.legalName && c.legalName !== c.company && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{c.legalName}</p>
                    )}
                  </div>
                </div>

                {c.contacts.filter((x) => x.name || x.email || x.phone).length > 0 && (
                  <div className="space-y-1.5">
                    {c.contacts
                      .filter((x) => x.name || x.email || x.phone)
                      .slice(0, 4)
                      .map((x, i) => (
                        <div key={i} className="text-sm">
                          {x.name && (
                            <span className="font-medium">
                              {x.name}
                              {x.role ? <span className="font-normal text-muted-foreground"> · {x.role}</span> : null}
                            </span>
                          )}
                          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                            {x.phone && (
                              <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{x.phone}</span>
                            )}
                            {x.email && (
                              <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" />{x.email}</span>
                            )}
                          </div>
                        </div>
                      ))}
                  </div>
                )}

                {c.mailingAddress && (
                  <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                    <span className="line-clamp-3">{c.mailingAddress}</span>
                  </div>
                )}
                {c.portalUrl && (
                  <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <LinkIcon className="mt-0.5 h-3 w-3 shrink-0" />
                    <span className="line-clamp-2">{c.portalUrl}</span>
                  </div>
                )}
                {c.paymentInfo && (
                  <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <CreditCard className="mt-0.5 h-3 w-3 shrink-0" />
                    <span className="line-clamp-4">{c.paymentInfo}</span>
                  </div>
                )}

                {c.propertiesServed.length > 0 && (
                  <div className="mt-auto flex flex-wrap gap-1 pt-1">
                    {c.propertiesServed.slice(0, 6).map((p, i) => (
                      <Badge key={i} variant="secondary" className="text-[10px] font-normal">{p}</Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          {companies.length} of {RENTAL_COMPANIES.length} companies. Most landlords bill through Lanyard → Bill.com
          (app02.us.bill.com). Source: June 2026 email harvest — re-run to refresh.
        </p>
      </div>
    </MainLayout>
  );
}

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  Plus,
  Trash2,
  UserPlus,
  AlertCircle,
  CalendarCheck2,
  Edit2,
  Check,
  X,
} from "lucide-react";
import {
  useListProjectedMoveIns,
  useCreateProjectedMoveIn,
  useUpdateProjectedMoveIn,
  useDeleteProjectedMoveIn,
  useConvertProjectedMoveIn,
  getListProjectedMoveInsQueryKey,
  getListBedsQueryKey,
  getListOccupantsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { useToast } from "@/hooks/use-toast";
import type { Bed, Occupant, Room, ProjectedMoveIn } from "@/data/mockData";
import { formatYMDPretty, isBlankYMD } from "@/lib/lease-dates";

const NO_BED_SENTINEL = "__none";
const STRICT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Returns whole days between today (UTC midnight) and a YYYY-MM-DD
 * string. Negative values mean the date has already passed.
 *
 * Uses UTC parsing because every date in the system is a calendar
 * date (no time component), so DST/local-tz shifts would otherwise
 * make a date that's "today" round to -1 in the wrong tz.
 */
function daysFromToday(ymd: string): number | null {
  if (!STRICT_DATE_RE.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / (24 * 60 * 60 * 1000));
}

interface ProjectedMoveInsSectionProps {
  propertyId: string;
  propRooms: Room[];
  propBeds: Bed[];
  propOccupants: Occupant[];
}

/**
 * "Projected Move-Ins" card on the Beds tab of property-detail
 * (Task #567).
 *
 * Lets operators pre-stage upcoming arrivals (name, planned date,
 * optional bed) days or weeks before the person actually shows up.
 * The card renders a small summary strip (total / next 7 days /
 * overdue), an inline add form, and the list of pending rows. Each
 * row has an inline-edit toggle, delete, and a one-click "Move
 * them in" button that hands off to the convert endpoint — which
 * creates the real Occupant, flips the bed to Occupied, and stamps
 * `convertedOccupantId` so this row drops out of the active list.
 *
 * All mutations are optimistic (matching the violations card a few
 * sections down) so the UI stays snappy on flaky connections; the
 * convert path also touches the beds + occupants caches because a
 * successful convert produces side effects in both.
 */
export function ProjectedMoveInsSection({
  propertyId,
  propRooms,
  propBeds,
  propOccupants,
}: ProjectedMoveInsSectionProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const listKey = useMemo(
    () => getListProjectedMoveInsQueryKey(propertyId),
    [propertyId],
  );
  const bedsKey = useMemo(() => getListBedsQueryKey(), []);
  const occupantsKey = useMemo(() => getListOccupantsQueryKey(), []);

  const query = useListProjectedMoveIns(propertyId, {
    query: { queryKey: listKey, enabled: Boolean(propertyId) },
  });
  const moveIns: ProjectedMoveIn[] = (query.data ??
    []) as ProjectedMoveIn[];

  const createMut = useCreateProjectedMoveIn();
  const updateMut = useUpdateProjectedMoveIn();
  const deleteMut = useDeleteProjectedMoveIn();
  const convertMut = useConvertProjectedMoveIn();

  // ----- Add form state -----
  const [addName, setAddName] = useState("");
  const [addDate, setAddDate] = useState("");
  const [addBedId, setAddBedId] = useState<string>(NO_BED_SENTINEL);
  const [addNotes, setAddNotes] = useState("");

  const resetAddForm = () => {
    setAddName("");
    setAddDate("");
    setAddBedId(NO_BED_SENTINEL);
    setAddNotes("");
  };

  // Bed dropdown shows every bed in the property (even occupied
  // ones — operators sometimes plan a swap), but we annotate the
  // current state inline so they know what they're picking.
  const bedOptions = useMemo(() => {
    return propBeds
      .map((bed) => {
        const room = propRooms.find((r) => r.id === bed.roomId);
        const occ = propOccupants.find((o) => o.bedId === bed.id);
        const cleaning = bed.cleaningStatus ?? "ready";
        const status = occ
          ? `occupied by ${occ.name || "—"}`
          : cleaning === "ready"
            ? "vacant · ready"
            : `vacant · cleaning: ${cleaning.replace(/_/g, " ")}`;
        return {
          id: bed.id,
          label: `${room?.name ?? "Room ?"} · Bed ${bed.bedNumber} (${status})`,
          ready: !occ && cleaning === "ready",
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [propBeds, propRooms, propOccupants]);

  const summary = useMemo(() => {
    let next7 = 0;
    let overdue = 0;
    for (const m of moveIns) {
      const d = daysFromToday(m.projectedMoveInDate);
      if (d === null) continue;
      if (d < 0) overdue++;
      else if (d <= 7) next7++;
    }
    return { total: moveIns.length, next7, overdue };
  }, [moveIns]);

  const handleAdd = () => {
    const trimmed = addName.trim();
    if (!trimmed) {
      toast({
        title: "Name required",
        description: "Add a name before saving the projected move-in.",
        variant: "destructive",
      });
      return;
    }
    if (!STRICT_DATE_RE.test(addDate)) {
      toast({
        title: "Date required",
        description: "Pick a projected move-in date (YYYY-MM-DD).",
        variant: "destructive",
      });
      return;
    }
    const bedId = addBedId === NO_BED_SENTINEL ? null : addBedId;
    const optimistic: ProjectedMoveIn = {
      id: `pmi-${Date.now()}`,
      propertyId,
      personName: trimmed,
      projectedMoveInDate: addDate,
      bedId,
      notes: addNotes,
      convertedOccupantId: null,
    };
    const snapshot =
      queryClient.getQueryData<ProjectedMoveIn[]>(listKey);
    queryClient.setQueryData<ProjectedMoveIn[]>(listKey, (prev) =>
      [...(prev ?? []), optimistic].sort((a, b) =>
        a.projectedMoveInDate.localeCompare(b.projectedMoveInDate),
      ),
    );
    resetAddForm();
    createMut.mutate(
      {
        id: propertyId,
        data: {
          id: optimistic.id,
          personName: optimistic.personName,
          projectedMoveInDate: optimistic.projectedMoveInDate,
          bedId: optimistic.bedId,
          notes: optimistic.notes,
        },
      },
      {
        onError: () => {
          if (snapshot !== undefined) {
            queryClient.setQueryData<ProjectedMoveIn[]>(listKey, snapshot);
          }
          toast({
            title: "Save failed",
            description:
              "Couldn't save the projected move-in. Your change was reverted.",
            variant: "destructive",
          });
        },
        onSettled: () => {
          queryClient.invalidateQueries({ queryKey: listKey });
        },
      },
    );
  };

  const handleDelete = (moveInId: string) => {
    const snapshot =
      queryClient.getQueryData<ProjectedMoveIn[]>(listKey);
    queryClient.setQueryData<ProjectedMoveIn[]>(listKey, (prev) =>
      (prev ?? []).filter((m) => m.id !== moveInId),
    );
    deleteMut.mutate(
      { id: propertyId, moveInId },
      {
        onError: () => {
          if (snapshot !== undefined) {
            queryClient.setQueryData<ProjectedMoveIn[]>(listKey, snapshot);
          }
          toast({
            title: "Delete failed",
            description:
              "Couldn't delete the projected move-in. Your change was reverted.",
            variant: "destructive",
          });
        },
        onSettled: () => {
          queryClient.invalidateQueries({ queryKey: listKey });
        },
      },
    );
  };

  const patchRow = (moveInId: string, updates: Partial<ProjectedMoveIn>) => {
    const snapshot =
      queryClient.getQueryData<ProjectedMoveIn[]>(listKey);
    queryClient.setQueryData<ProjectedMoveIn[]>(listKey, (prev) =>
      (prev ?? [])
        .map((m) => (m.id === moveInId ? { ...m, ...updates } : m))
        .sort((a, b) =>
          a.projectedMoveInDate.localeCompare(b.projectedMoveInDate),
        ),
    );
    updateMut.mutate(
      { id: propertyId, moveInId, data: updates },
      {
        onError: () => {
          if (snapshot !== undefined) {
            queryClient.setQueryData<ProjectedMoveIn[]>(listKey, snapshot);
          }
          toast({
            title: "Save failed",
            description:
              "Couldn't save the projected move-in. Your change was reverted.",
            variant: "destructive",
          });
        },
        onSettled: () => {
          queryClient.invalidateQueries({ queryKey: listKey });
        },
      },
    );
  };

  const handleConvert = (m: ProjectedMoveIn) => {
    if (!m.bedId) {
      toast({
        title: "Pick a bed first",
        description:
          "Edit this projection and choose a bed before moving them in.",
        variant: "destructive",
      });
      return;
    }
    convertMut.mutate(
      { id: propertyId, moveInId: m.id, data: { bedId: m.bedId } },
      {
        onSuccess: () => {
          // Drop the row from the active list immediately and
          // refresh the side-effect caches (beds toggled to
          // Occupied, occupants got a new row) so the rest of the
          // Beds tab updates without waiting for a navigation.
          queryClient.setQueryData<ProjectedMoveIn[]>(listKey, (prev) =>
            (prev ?? []).filter((row) => row.id !== m.id),
          );
          queryClient.invalidateQueries({ queryKey: bedsKey });
          queryClient.invalidateQueries({ queryKey: occupantsKey });
          queryClient.invalidateQueries({ queryKey: listKey });
          toast({
            title: "Moved in",
            description: `${m.personName || "Occupant"} is now on the bed roster.`,
          });
        },
        onError: (err) => {
          // Bubble up the server's specific message (e.g. "bed is
          // currently occupied", "cleaning not finished") so the
          // operator knows which problem to fix instead of guessing.
          const message =
            err instanceof Error && err.message
              ? err.message
              : "The bed is unavailable. Pick a different one and try again.";
          queryClient.invalidateQueries({ queryKey: listKey });
          queryClient.invalidateQueries({ queryKey: bedsKey });
          toast({
            title: "Couldn't move them in",
            description: message,
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <Card data-testid="card-projected-move-ins">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="w-4 h-4 text-blue-600" />
              Projected Move-Ins
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Pre-stage upcoming arrivals here. Once they show up,
              click "Move them in" to create the real occupant and
              link the bed in one step.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Badge variant="secondary" data-testid="badge-projected-total">
              {summary.total} planned
            </Badge>
            <Badge
              className={
                summary.next7 > 0
                  ? "bg-amber-100 text-amber-900 border-amber-200"
                  : "bg-muted text-muted-foreground border-transparent"
              }
              data-testid="badge-projected-next7"
            >
              <CalendarCheck2 className="w-3 h-3 mr-1" />
              {summary.next7} in next 7 days
            </Badge>
            <Badge
              className={
                summary.overdue > 0
                  ? "bg-rose-100 text-rose-900 border-rose-200"
                  : "bg-muted text-muted-foreground border-transparent"
              }
              data-testid="badge-projected-overdue"
            >
              <AlertCircle className="w-3 h-3 mr-1" />
              {summary.overdue} overdue
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* ── Add row ── */}
        <div className="grid gap-2 md:grid-cols-[1.4fr_0.9fr_1.6fr_1.4fr_auto] items-end p-3 rounded-md border bg-muted/20">
          <div className="space-y-1">
            <Label htmlFor="pmi-add-name" className="text-xs">
              Name
            </Label>
            <Input
              id="pmi-add-name"
              data-testid="input-projected-name"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              placeholder="e.g. Maria Santos"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pmi-add-date" className="text-xs">
              Projected date
            </Label>
            <Input
              id="pmi-add-date"
              data-testid="input-projected-date"
              type="date"
              value={addDate}
              onChange={(e) => setAddDate(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pmi-add-bed" className="text-xs">
              Bed (optional)
            </Label>
            <Select value={addBedId} onValueChange={setAddBedId}>
              <SelectTrigger
                id="pmi-add-bed"
                data-testid="select-projected-bed"
              >
                <SelectValue placeholder="No bed yet" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_BED_SENTINEL}>
                  No bed yet
                </SelectItem>
                {bedOptions.map((opt) => (
                  <SelectItem key={opt.id} value={opt.id}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="pmi-add-notes" className="text-xs">
              Notes
            </Label>
            <Input
              id="pmi-add-notes"
              data-testid="input-projected-notes"
              value={addNotes}
              onChange={(e) => setAddNotes(e.target.value)}
              placeholder="e.g. with crew B"
            />
          </div>
          <Button
            size="sm"
            data-testid="button-projected-add"
            onClick={handleAdd}
          >
            <Plus className="w-4 h-4 mr-1" /> Add
          </Button>
        </div>

        {/* ── List ── */}
        {moveIns.length === 0 ? (
          <p
            className="text-sm text-muted-foreground italic"
            data-testid="text-projected-empty"
          >
            No upcoming move-ins planned for this property yet.
          </p>
        ) : (
          <ul className="space-y-2" data-testid="list-projected-move-ins">
            {moveIns
              .slice()
              .sort((a, b) =>
                a.projectedMoveInDate.localeCompare(b.projectedMoveInDate),
              )
              .map((m) => (
                <ProjectedMoveInRow
                  key={m.id}
                  row={m}
                  bedOptions={bedOptions}
                  onSave={(updates) => patchRow(m.id, updates)}
                  onDelete={() => handleDelete(m.id)}
                  onConvert={() => handleConvert(m)}
                />
              ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

interface RowProps {
  row: ProjectedMoveIn;
  bedOptions: { id: string; label: string; ready: boolean }[];
  onSave: (updates: Partial<ProjectedMoveIn>) => void;
  onDelete: () => void;
  onConvert: () => void;
}

function ProjectedMoveInRow({
  row,
  bedOptions,
  onSave,
  onDelete,
  onConvert,
}: RowProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(row.personName);
  const [date, setDate] = useState(row.projectedMoveInDate);
  const [bedId, setBedId] = useState<string>(
    row.bedId ?? NO_BED_SENTINEL,
  );
  const [notes, setNotes] = useState(row.notes);

  const days = daysFromToday(row.projectedMoveInDate);
  const flag =
    days === null
      ? null
      : days < 0
        ? {
            label: `Overdue · ${Math.abs(days)}d ago`,
            cls: "bg-rose-100 text-rose-900 border-rose-200",
          }
        : days === 0
          ? {
              label: "Today",
              cls: "bg-emerald-100 text-emerald-900 border-emerald-200",
            }
          : days <= 7
            ? {
                label: `In ${days}d`,
                cls: "bg-amber-100 text-amber-900 border-amber-200",
              }
            : {
                label: `In ${days}d`,
                cls: "bg-muted text-muted-foreground border-border",
              };

  const bedLabel =
    row.bedId
      ? (bedOptions.find((b) => b.id === row.bedId)?.label ??
        "Bed (no longer in this property)")
      : "No bed assigned yet";

  const enterEdit = () => {
    setName(row.personName);
    setDate(row.projectedMoveInDate);
    setBedId(row.bedId ?? NO_BED_SENTINEL);
    setNotes(row.notes);
    setEditing(true);
  };

  const saveEdit = () => {
    onSave({
      personName: name.trim(),
      projectedMoveInDate: date,
      bedId: bedId === NO_BED_SENTINEL ? null : bedId,
      notes,
    });
    setEditing(false);
  };

  if (editing) {
    return (
      <li
        className="grid gap-2 md:grid-cols-[1.4fr_0.9fr_1.6fr_1.4fr_auto] items-end p-3 rounded-md border bg-background"
        data-testid={`row-projected-edit-${row.id}`}
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Name"
        />
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Projected date"
        />
        <Select value={bedId} onValueChange={setBedId}>
          <SelectTrigger aria-label="Bed">
            <SelectValue placeholder="No bed yet" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_BED_SENTINEL}>No bed yet</SelectItem>
            {bedOptions.map((opt) => (
              <SelectItem key={opt.id} value={opt.id}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          aria-label="Notes"
          placeholder="Notes"
        />
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="default"
            onClick={saveEdit}
            data-testid={`button-projected-save-${row.id}`}
          >
            <Check className="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setEditing(false)}
            data-testid={`button-projected-cancel-${row.id}`}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li
      className="flex items-center justify-between gap-3 p-3 rounded-md border bg-background flex-wrap"
      data-testid={`row-projected-${row.id}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="font-medium truncate"
            data-testid={`text-projected-name-${row.id}`}
          >
            {row.personName || "(no name)"}
          </span>
          {flag && (
            <Badge
              className={flag.cls}
              data-testid={`badge-projected-flag-${row.id}`}
            >
              {flag.label}
            </Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          {isBlankYMD(row.projectedMoveInDate)
            ? "No date"
            : formatYMDPretty(row.projectedMoveInDate)}{" "}
          · {bedLabel}
          {row.notes ? (
            <>
              {" · "}
              <span className="italic">{row.notes}</span>
            </>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="default"
          onClick={onConvert}
          data-testid={`button-projected-convert-${row.id}`}
        >
          <UserPlus className="w-4 h-4 mr-1" /> Move them in
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={enterEdit}
          aria-label="Edit projected move-in"
          data-testid={`button-projected-edit-${row.id}`}
        >
          <Edit2 className="w-4 h-4" />
        </Button>
        <ConfirmDeleteButton
          trigger={
            <Button
              size="sm"
              variant="ghost"
              aria-label="Delete projected move-in"
              data-testid={`button-projected-delete-${row.id}`}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          }
          title="Delete projected move-in?"
          description={`This removes the planned arrival for ${row.personName || "this person"}. You can re-add it later if their plans change.`}
          onConfirm={onDelete}
          testId={`dialog-projected-delete-${row.id}`}
        />
      </div>
    </li>
  );
}

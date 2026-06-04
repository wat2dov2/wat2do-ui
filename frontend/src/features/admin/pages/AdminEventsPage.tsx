import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Calendar, MapPin, Tag, AlertTriangle, Edit, Trash2, Plus } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  TableCell,
  TableRow,
} from "@/shared/ui/table";
import { EventDetailsModal, useEventsStore } from "@/features/events";
import { useAdminEventsPage } from "@/features/admin/hooks/useAdminEventsPage";
import type { Event } from "@/shared/types";
import { AdminPageHeader } from "@/features/admin/components/shared/AdminPageHeader";
import { AdminSearchBar } from "@/features/admin/components/shared/AdminSearchBar";
import { AdminResultsCount } from "@/features/admin/components/shared/AdminResultsCount";
import { Pagination } from "@/shared/ui/Pagination";
import { AdminEmptyState } from "@/features/admin/components/shared/AdminEmptyState";
import { AdminDeleteDialog } from "@/features/admin/components/shared/AdminDeleteDialog";
import { AdminTable } from "@/features/admin/components/shared/AdminTable";
import { cn } from "@/shared/lib/utils";
import { ADMIN_ITEMS_PER_PAGE } from "@/features/admin/constants";
import { QP } from "@/shared/constants/queryParams";
import { formatCardDate } from "@/shared/utils/date";
import { useUIStore } from "@/shared/store/ui.store";

const ITEMS_PER_PAGE = ADMIN_ITEMS_PER_PAGE;

interface AdminEventsPageProps {
  onBack: () => void;
}

export function AdminEventsPage({
  onBack,
}: AdminEventsPageProps) {
  const events = useEventsStore((s) => s.events);
  const deleteEvent = useEventsStore((s) => s.deleteEvent);
  
  const setEditingEvent = useUIStore((s) => s.setEditingEvent);
  const setShowSubmitEvent = useUIStore((s) => s.setShowSubmitEvent);

  const onCreateEvent = () => {
    setEditingEvent(null); // Clear editing state first
    setShowSubmitEvent(true);
  };

  const onEditEvent = (event: Event) => {
    setEditingEvent(event);
    setShowSubmitEvent(true);
  };

  const { t, i18n } = useTranslation();
  const {
    searchQuery,
    selectedCategory,
    showReportedOnly,
    deleteConfirmId,
    highlightedEventId,
    currentPage,
    selectedEvent,
    categories,
    filteredEvents,
    paginatedEvents,
    totalPages,
    searchParams,
    setSearchParams,
    setSearchQuery,
    setSelectedCategory,
    toggleReportedOnly,
    setDeleteConfirmId,
    setCurrentPage,
    isEventReported,
  } = useAdminEventsPage({ events, itemsPerPage: ITEMS_PER_PAGE });

  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async (eventId: number) => {
    setIsDeleting(true);
    try {
      await Promise.resolve(deleteEvent(eventId));
      setDeleteConfirmId(null);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-5">
      <AdminPageHeader
        icon={Calendar}
        title={t("admin.manageEvents")}
        description={t("admin.manageEventsDesc")}
        onBack={onBack}
        action={
          onCreateEvent
            ? {
                label: t("events.createEvent"),
                onClick: onCreateEvent,
                icon: Plus,
              }
            : undefined
        }
      />

      {/* Search and Filters */}
      <div className="flex gap-3">
        <AdminSearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder={t("admin.searchEvents")}
        />
        <Select
          value={selectedCategory || undefined}
          onValueChange={(value) => setSelectedCategory(value || "")}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={t("admin.allCategories")} />
          </SelectTrigger>
          <SelectContent>
            {categories.map((cat) => (
              <SelectItem key={cat} value={cat}>
                {cat}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={toggleReportedOnly}
          aria-pressed={showReportedOnly}
          className={cn(
            "flex items-center gap-2 px-3 py-1 h-9 whitespace-nowrap [&_svg]:shrink-0 [&_svg]:size-4 transition-all",
            showReportedOnly
              ? "bg-primary/80! text-primary-foreground! hover:bg-primary/80! hover:text-primary-foreground! [&_svg]:text-primary-foreground!"
              : "bg-secondary text-muted-foreground hover:bg-secondary"
          )}
        >
          <AlertTriangle className="size-4" />
          {t("admin.reportedOnly")}
        </Button>
      </div>

      <AdminResultsCount
        count={filteredEvents.length}
        singularLabel={t("common.event")}
        pluralLabel={t("common.events")}
      />

      {/* Events Table */}
      {filteredEvents.length > 0 ? (
        <AdminTable
          headers={[
            { label: t("events.eventTitle") },
            { label: t("events.club") },
            { label: t("filters.date") },
            { label: t("filters.location") },
            { label: t("filters.category") },
            { label: t("events.status") },
            { label: t("common.actions"), align: "right" },
          ]}
        >
              {paginatedEvents.map((event) => {
                const isReported = isEventReported(event.id);
                const isHighlighted = highlightedEventId === event.id;
                return (
                  <TableRow
                    key={event.id}
                    id={`event-${event.id}`}
                    className={`cursor-pointer hover:bg-secondary/50 ${isHighlighted ? "bg-primary/10" : ""}`}
                    onClick={() => {
                      const newParams = new URLSearchParams(searchParams);
                      newParams.set(QP.EVENT_ID, event.id.toString());
                      setSearchParams(newParams);
                    }}
                  >
                    <TableCell>
                      <div className="font-medium text-sm text-foreground">
                        {event.title}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm text-muted-foreground">
                        {event.organization}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Calendar className="size-3.5" />
                        <span>{formatCardDate(event, i18n.language || "en-US")}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <MapPin className="size-3.5" />
                        <span className="max-w-[150px] truncate">
                          {event.location}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Tag className="size-3.5 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">
                          {event.category}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {isReported ? (
                        <div className="flex items-center gap-1.5">
                          <AlertTriangle className="size-3.5 text-error" />
                          <span className="text-xs text-error font-medium">
                            {t("admin.reported")}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {t("common.live")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="secondary"
                          size="icon-sm"
                          onClick={async (e) => {
                            e.stopPropagation();
                            await onEditEvent?.(event);
                          }}
                          title={t("admin.editEvent")}
                        >
                          <Edit className="size-4" />
                        </Button>
                        <Button
                          variant="secondary"
                          size="icon-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConfirmId(event.id);
                          }}
                          title={t("admin.deleteEvent")}
                          className="hover:bg-error/10 hover:text-error"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
        </AdminTable>
      ) : (
        <AdminEmptyState
          icon={Calendar}
          title={t("admin.noEventsFound")}
          description={t("admin.noEventsMatchFilters")}
        />
      )}

      {/* Event Details Modal */}
      <EventDetailsModal
        event={selectedEvent}
        onClose={() => {
          const newParams = new URLSearchParams(searchParams);
          newParams.delete(QP.EVENT_ID);
          setSearchParams(newParams);
        }}
        allEvents={events}
        hideSimilarEvents
      />

      {filteredEvents.length > 0 && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={filteredEvents.length}
          itemsPerPage={ITEMS_PER_PAGE}
          itemLabel={t("common.event")}
          itemLabelPlural={t("common.events")}
          onPageChange={setCurrentPage}
        />
      )}

      <AdminDeleteDialog
        isOpen={deleteConfirmId !== null}
        onClose={() => setDeleteConfirmId(null)}
        onConfirm={() => deleteConfirmId != null && handleDelete(deleteConfirmId)}
        title={t("events.deleteEventTitle")}
        description={t("events.deleteEventConfirm", {
          title: deleteConfirmId
            ? events.find((e) => e.id === deleteConfirmId)?.title || ""
            : "",
        })}
        isLoading={isDeleting}
      />
    </div>
  );
}

import React from "react";
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
  TableBody,
  TableCell,
  TableRow,
} from "@/shared/ui/table";
import { EventDetailsModal } from "@/features/events";
import { useAdminEventsPage } from "@/features/admin/hooks/useAdminEventsPage";
import { useAdminContext } from "@/features/admin/context/AdminContext";
import { AdminPageHeader } from "@/features/admin/components/shared/AdminPageHeader";
import { AdminSearchBar } from "@/features/admin/components/shared/AdminSearchBar";
import { AdminResultsCount } from "@/features/admin/components/shared/AdminResultsCount";
import { AdminPagination } from "@/features/admin/components/shared/AdminPagination";
import { AdminEmptyState } from "@/features/admin/components/shared/AdminEmptyState";
import { AdminDeleteDialog } from "@/features/admin/components/shared/AdminDeleteDialog";
import { AdminTable } from "@/features/admin/components/shared/AdminTable";

const ITEMS_PER_PAGE = 20;

export function AdminEventsPage() {
  const { events, onEditEvent, onDeleteEvent, onBack, onCreateEvent } = useAdminContext();
  const { t } = useTranslation();
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

  const handleDelete = (eventId: number) => {
    onDeleteEvent(eventId);
    setDeleteConfirmId(null);
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
          variant={showReportedOnly ? "default" : "outline"}
          onClick={toggleReportedOnly}
          className="flex items-center gap-2"
        >
          <AlertTriangle className="w-4 h-4" />
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
            { label: t("events.organization") },
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
                    className={`cursor-pointer hover:bg-muted/50 ${isHighlighted ? "bg-primary/10" : ""}`}
                    onClick={() => {
                      const newParams = new URLSearchParams(searchParams);
                      newParams.set("eventId", event.id.toString());
                      setSearchParams(newParams);
                    }}
                  >
                    <TableCell>
                      <div className="font-medium text-sm text-gray-900">
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
                        <Calendar className="w-3.5 h-3.5" />
                        <span>{event.date}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <MapPin className="w-3.5 h-3.5" />
                        <span className="max-w-[150px] truncate">
                          {event.location}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Tag className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">
                          {event.category}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {isReported ? (
                        <div className="flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 text-error" />
                          <span className="text-xs text-error font-medium">
                            Reported
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Live
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            onEditEvent(event);
                          }}
                          title={t("admin.editEvent")}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConfirmId(event.id);
                          }}
                          title={t("admin.deleteEvent")}
                          className="hover:bg-error/10 hover:text-error"
                        >
                          <Trash2 className="w-4 h-4" />
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
          newParams.delete("eventId");
          setSearchParams(newParams);
        }}
        allEvents={events}
      />

      {filteredEvents.length > 0 && (
        <AdminPagination
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
        onConfirm={() => deleteConfirmId && handleDelete(deleteConfirmId)}
        title={t("events.deleteEventTitle")}
        description={t("events.deleteEventConfirm", {
          title: deleteConfirmId
            ? events.find((e) => e.id === deleteConfirmId)?.title || ""
            : "",
        })}
      />
    </div>
  );
}

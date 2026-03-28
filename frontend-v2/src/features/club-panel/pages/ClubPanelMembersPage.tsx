import React from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Users } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { useNavigation } from "@/contexts/NavigationContext";

export function ClubPanelMembersPage() {
  const { t } = useTranslation();
  const { navigate } = useNavigation();

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          size="icon"
          onClick={() => navigate("/club-panel")}
          className="shrink-0"
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
          <Users className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("clubPanel.members")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("clubPanel.membersDesc")}
          </p>
        </div>
      </div>

      {/* Members Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th className="text-left text-sm font-medium text-muted-foreground px-6 py-3">
                Name
              </th>
              <th className="text-left text-sm font-medium text-muted-foreground px-6 py-3">
                Email
              </th>
              <th className="text-left text-sm font-medium text-muted-foreground px-6 py-3">
                Role
              </th>
              <th className="text-left text-sm font-medium text-muted-foreground px-6 py-3">
                Joined
              </th>
            </tr>
          </thead>
          <tbody>
            {/* Empty state */}
          </tbody>
        </table>

        {/* Empty State */}
        <div className="p-12 text-center">
          <Users className="w-12 h-12 text-muted-foreground/50 mx-auto mb-4" />
          <h3 className="font-semibold text-gray-900 mb-1">{t("clubPanel.noMembersYet")}</h3>
          <p className="text-sm text-muted-foreground">
            {t("clubPanel.noMembersDesc")}
          </p>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Section, Stack } from "@/shared/layout";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/shared/ui/field";
import { Checkbox } from "@/shared/ui/checkbox";
import { DatePicker } from "@/shared/ui/date-picker";
import { Input } from "@/shared/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Switch } from "@/shared/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { Textarea } from "@/shared/ui/textarea";
import { ShowcaseBlock } from "./ShowcaseBlock";

export function FormControlsSection() {
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [activeTab, setActiveTab] = useState("events");
  const [selectedDate, setSelectedDate] = useState("");

  return (
    <Section
      id="form-controls"
      title="Form Controls"
      description="Individual field controls and accessible composition. For page structure, use Form Layout primitives."
      variant="surface"
    >
      <Stack gap={6}>
        <ShowcaseBlock label="Input">
          <Input placeholder="Search events..." />
        </ShowcaseBlock>

        <ShowcaseBlock label="Date picker">
          <Field>
            <FieldLabel htmlFor="design-system-date">Event date</FieldLabel>
            <DatePicker
              id="design-system-date"
              value={selectedDate}
              onChange={setSelectedDate}
              placeholder="Pick a date"
            />
          </Field>
        </ShowcaseBlock>

        <ShowcaseBlock label="Textarea">
          <Textarea placeholder="Add event details..." rows={3} />
        </ShowcaseBlock>

        <ShowcaseBlock label="Select">
          <Select defaultValue="events">
            <SelectTrigger className="w-full max-w-xs">
              <SelectValue placeholder="Choose category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="events">Events</SelectItem>
              <SelectItem value="clubs">Clubs</SelectItem>
              <SelectItem value="career">Career</SelectItem>
            </SelectContent>
          </Select>
        </ShowcaseBlock>

        <ShowcaseBlock label="Checkbox">
          <Field orientation="horizontal-start">
            <Checkbox
              id="design-system-checkbox"
              checked={termsAccepted}
              onCheckedChange={(checked) => setTermsAccepted(checked === true)}
            />
            <FieldLabel htmlFor="design-system-checkbox">
              I agree to the campus event guidelines
            </FieldLabel>
          </Field>
        </ShowcaseBlock>

        <ShowcaseBlock label="Switch">
          <Field orientation="horizontal">
            <Switch
              id="design-system-switch"
              checked={notificationsEnabled}
              onCheckedChange={setNotificationsEnabled}
            />
            <FieldLabel htmlFor="design-system-switch">
              {notificationsEnabled ? "Notifications on" : "Notifications off"}
            </FieldLabel>
          </Field>
        </ShowcaseBlock>

        <ShowcaseBlock label="Tabs">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="events">Events</TabsTrigger>
              <TabsTrigger value="submissions">Submissions</TabsTrigger>
            </TabsList>
            <TabsContent value="events" className="mt-3 text-sm text-muted-foreground">
              Browse and manage published events.
            </TabsContent>
            <TabsContent value="submissions" className="mt-3 text-sm text-muted-foreground">
              Review events submitted for approval.
            </TabsContent>
          </Tabs>
        </ShowcaseBlock>

        <ShowcaseBlock label="Field composition">
          <FieldGroup className="max-w-md">
            <Field>
              <FieldLabel htmlFor="design-system-email">Email</FieldLabel>
              <Input
                id="design-system-email"
                type="email"
                placeholder="you@uwaterloo.ca"
              />
              <FieldDescription>
                We only use this for account notifications.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </ShowcaseBlock>
      </Stack>
    </Section>
  );
}

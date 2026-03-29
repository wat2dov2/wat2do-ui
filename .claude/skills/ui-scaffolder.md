---
name: ui-scaffolder
description: Use this when the user asks to "make a component," "build a form," "create a page," "create a modal," "create a dashboard," "add a card," or "build UI." Contains gold-standard component patterns for the corkboard design system.
allowed-tools: Read, Edit, Write, Glob, Grep
---

# UI Component Scaffolder

You are building UI components for the wat2do-v2 corkboard design system. Follow these exact patterns — do not improvise styling.

## Required Imports

```typescript
// ALWAYS use these
import { cn } from "@/shared/lib/utils";          // Class merging (clsx + tailwind-merge)
import { useTranslation } from "react-i18next";   // All visible text must use t()

// Use as needed
import { cva, type VariantProps } from "class-variance-authority";  // For variant components
import { Slot } from "@radix-ui/react-slot";       // For asChild pattern
```

## Pattern 1: Variant Component (Button-style)

Use CVA when the component has multiple visual variants.

```typescript
const badgeVariants = cva(
  // Base styles — always applied
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        destructive: "bg-destructive text-destructive-foreground",
        outline: "border border-border text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}
```

**Rules:**
- Every component gets `data-slot="component-name"`
- Always end className with `cn(variants, className)` to allow overrides
- Export both the component and the variants function

## Pattern 2: Composite Component (Card-style)

Use for components with semantic sub-parts.

```typescript
function InfoCard({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="info-card"
      className={cn(
        "bg-card text-card-foreground flex flex-col gap-4 rounded-xl border p-6 shadow-sm",
        className
      )}
      {...props}
    />
  );
}

function InfoCardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="info-card-header"
      className={cn("flex items-center gap-2", className)}
      {...props}
    />
  );
}

function InfoCardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return (
    <h3
      data-slot="info-card-title"
      className={cn("font-semibold leading-none", className)}
      {...props}
    />
  );
}

function InfoCardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="info-card-content"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export { InfoCard, InfoCardHeader, InfoCardTitle, InfoCardContent };
```

**Rules:**
- Each sub-component is its own function with its own `data-slot`
- Sub-components use minimal styling — just layout and typography
- Export all sub-components as named exports

## Pattern 3: Form with FormField Composition

Use the existing form field components from `@/shared/ui/form-field`.

```typescript
import { FormInput, FormSelect, FormTextarea } from "@/shared/ui/form-field";
import { Field, FieldGroup, FieldSet, FieldLegend, FieldSeparator } from "@/shared/ui/field";

function MyForm() {
  const { t } = useTranslation();
  const { formData, updateField, errors, touched, handleBlur } = useMyFormContext();

  return (
    <FieldGroup>
      <FieldSet>
        <FieldLegend>{t("myFeature.sectionTitle")}</FieldLegend>
        <FieldGroup>
          <FormInput
            name="title"
            label={t("forms.title")}
            required
            value={formData.title}
            onChange={(value) => updateField("title", value as string)}
            onBlur={() => handleBlur("title")}
            error={errors.title}
            touched={touched.title}
          />

          <FieldGroup className="grid grid-cols-2">
            <FormSelect
              name="category"
              label={t("filters.category")}
              value={formData.category}
              onChange={(value) => updateField("category", value)}
              options={categories.map((c) => ({ value: c, label: t(`categories.${c}`) }))}
            />
            <FormInput
              name="price"
              label={t("filters.price")}
              type="number"
              value={formData.price}
              onChange={(value) => updateField("price", value as number)}
              prefix="$"
            />
          </FieldGroup>
        </FieldGroup>
      </FieldSet>

      <FieldSeparator />

      <FieldSet>
        <FieldLegend>{t("myFeature.optionalDetails")}</FieldLegend>
        <FormTextarea
          name="description"
          label={t("forms.description")}
          value={formData.description}
          onChange={(value) => updateField("description", value)}
          rows={3}
        />
      </FieldSet>
    </FieldGroup>
  );
}
```

**Rules:**
- Use `FieldGroup` for grouping, `FieldSet`/`FieldLegend` for sections, `FieldSeparator` between sections
- Use `grid grid-cols-2` on `FieldGroup` for multi-column layouts
- Always pass `error`, `touched`, `onBlur` for validated fields
- Number inputs: the FormInput handles the string→number conversion internally

## Pattern 4: Modal/Dialog

Wrap Radix Dialog primitives with project components.

```typescript
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";

function MyModal({ open, onOpenChange, data }: MyModalProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("myFeature.modalTitle")}</DialogTitle>
          <DialogDescription>{t("myFeature.modalDescription")}</DialogDescription>
        </DialogHeader>

        {/* Content here */}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSubmit}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

## Pattern 5: Feature Page Component

```typescript
import React from "react";
import { useTranslation } from "react-i18next";

export function MyFeaturePage() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">{t("myFeature.title")}</h1>
        <Button onClick={handleAction}>{t("myFeature.action")}</Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((item) => (
          <MyCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}
```

## Design Token Reference

| Token | Use for |
|---|---|
| `bg-card` / `text-card-foreground` | Card surfaces |
| `bg-secondary` / `text-secondary-foreground` | Inputs, secondary surfaces |
| `bg-muted` / `text-muted-foreground` | Disabled, helper text |
| `text-foreground` | Primary text |
| `text-destructive` | Errors |
| `border-border` | Standard borders |
| `rounded-xl` | Default border radius (cards, inputs, buttons) |
| `rounded-full` | Badges, pills |
| `shadow-sm` | Cards |
| `shadow-lg` | Modals, elevated surfaces |

## Constraints

- Never use raw hex colors — always use design tokens (`bg-primary`, `text-foreground`, etc.)
- Never create new base UI components — check `frontend/src/shared/ui/` first
- Never skip `data-slot` on new components
- Never hardcode user-visible strings — always use `t()` from useTranslation
- Never use `any` type — always define proper interfaces
- Use lucide-react for icons (already installed): `import { IconName } from "lucide-react"`
- Start immediately with the component code — no preamble

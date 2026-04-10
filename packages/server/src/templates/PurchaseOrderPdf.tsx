/**
 * @module templates/PurchaseOrderPdf
 *
 * React PDF component for generating purchase order documents.
 * Rendered server-side via @react-pdf/renderer.
 * Styled for print: light background, professional layout.
 */

import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

// ── Types ────────────────────────────────────────────────────────────

export interface POPdfLine {
  ingredientName: string;
  orderedQty: string;
  orderedUnit: string;
  unitCost: string | null;
}

export interface POPdfData {
  poNumber: string;
  organisationName: string;
  locationName: string;
  supplierName: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  expectedDeliveryDate: string | null;
  notes: string | null;
  createdByName: string;
  createdDate: string;
  lines: POPdfLine[];
  totalValue: string | null;
  currency: string;
}

// ── Styles ───────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#1a1a1a",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 30,
    borderBottomWidth: 2,
    borderBottomColor: "#D4A574",
    paddingBottom: 15,
  },
  orgName: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    color: "#1a1a1a",
  },
  poTitle: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: "#D4A574",
  },
  poNumber: {
    fontSize: 11,
    color: "#666666",
    marginTop: 4,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: "#D4A574",
    marginBottom: 8,
    textTransform: "uppercase" as const,
    letterSpacing: 1,
  },
  row: {
    flexDirection: "row",
    marginBottom: 3,
  },
  label: {
    width: 120,
    fontFamily: "Helvetica-Bold",
    color: "#444444",
  },
  value: {
    flex: 1,
    color: "#1a1a1a",
  },
  // Table
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f5f0eb",
    borderBottomWidth: 1,
    borderBottomColor: "#D4A574",
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#e5e5e5",
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  tableRowAlt: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#e5e5e5",
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: "#fafafa",
  },
  colItem: { flex: 3 },
  colQty: { flex: 1, textAlign: "right" as const },
  colUnit: { flex: 1, textAlign: "center" as const },
  colPrice: { flex: 1, textAlign: "right" as const },
  colTotal: { flex: 1, textAlign: "right" as const },
  headerText: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    color: "#666666",
    textTransform: "uppercase" as const,
  },
  // Footer
  totalRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 2,
    borderTopColor: "#D4A574",
  },
  totalLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 12,
    marginRight: 20,
  },
  totalValue: {
    fontFamily: "Helvetica-Bold",
    fontSize: 12,
    color: "#D4A574",
  },
  notes: {
    marginTop: 20,
    padding: 12,
    backgroundColor: "#f9f7f5",
    borderRadius: 4,
  },
  notesLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    color: "#999999",
    marginBottom: 4,
  },
  footer: {
    position: "absolute",
    bottom: 30,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 0.5,
    borderTopColor: "#e5e5e5",
    paddingTop: 8,
    fontSize: 8,
    color: "#999999",
  },
});

// ── Component ────────────────────────────────────────────────────────

export function PurchaseOrderPdf({ data }: { data: POPdfData }) {
  const formatCurrency = (val: string | null) => {
    if (!val) return "-";
    return `${data.currency} ${Number(val).toFixed(2)}`;
  };

  const lineTotal = (line: POPdfLine) => {
    if (!line.unitCost) return "-";
    return formatCurrency(String(Number(line.orderedQty) * Number(line.unitCost)));
  };

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.orgName}>{data.organisationName}</Text>
            <Text style={{ fontSize: 9, color: "#999999", marginTop: 2 }}>
              {data.locationName}
            </Text>
          </View>
          <View style={{ alignItems: "flex-end" as const }}>
            <Text style={styles.poTitle}>Purchase Order</Text>
            <Text style={styles.poNumber}>{data.poNumber}</Text>
            <Text style={{ fontSize: 9, color: "#999999", marginTop: 2 }}>
              {data.createdDate}
            </Text>
          </View>
        </View>

        {/* Supplier Details */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Supplier</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Name</Text>
            <Text style={styles.value}>{data.supplierName}</Text>
          </View>
          {data.contactName && (
            <View style={styles.row}>
              <Text style={styles.label}>Contact</Text>
              <Text style={styles.value}>{data.contactName}</Text>
            </View>
          )}
          {data.contactEmail && (
            <View style={styles.row}>
              <Text style={styles.label}>Email</Text>
              <Text style={styles.value}>{data.contactEmail}</Text>
            </View>
          )}
          {data.contactPhone && (
            <View style={styles.row}>
              <Text style={styles.label}>Phone</Text>
              <Text style={styles.value}>{data.contactPhone}</Text>
            </View>
          )}
          {data.expectedDeliveryDate && (
            <View style={styles.row}>
              <Text style={styles.label}>Expected Delivery</Text>
              <Text style={styles.value}>{data.expectedDeliveryDate}</Text>
            </View>
          )}
        </View>

        {/* Line Items Table */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Order Items</Text>
          <View style={styles.tableHeader}>
            <Text style={[styles.headerText, styles.colItem]}>Item</Text>
            <Text style={[styles.headerText, styles.colQty]}>Qty</Text>
            <Text style={[styles.headerText, styles.colUnit]}>Unit</Text>
            <Text style={[styles.headerText, styles.colPrice]}>Unit Price</Text>
            <Text style={[styles.headerText, styles.colTotal]}>Total</Text>
          </View>
          {data.lines.map((line, i) => (
            <View key={i} style={i % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
              <Text style={styles.colItem}>{line.ingredientName}</Text>
              <Text style={styles.colQty}>{Number(line.orderedQty).toFixed(1)}</Text>
              <Text style={styles.colUnit}>{line.orderedUnit}</Text>
              <Text style={styles.colPrice}>{formatCurrency(line.unitCost)}</Text>
              <Text style={styles.colTotal}>{lineTotal(line)}</Text>
            </View>
          ))}
        </View>

        {/* Total */}
        {data.totalValue && (
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{formatCurrency(data.totalValue)}</Text>
          </View>
        )}

        {/* Notes */}
        {data.notes && (
          <View style={styles.notes}>
            <Text style={styles.notesLabel}>Notes</Text>
            <Text>{data.notes}</Text>
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer}>
          <Text>Created by {data.createdByName}</Text>
          <Text>CulinAIre Kitchen</Text>
        </View>
      </Page>
    </Document>
  );
}

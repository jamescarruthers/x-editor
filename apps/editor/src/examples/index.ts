import {
  EXAMPLE_RULES,
  EXAMPLE_RULES_NAME,
  EXAMPLE_SCHEMA,
  EXAMPLE_SCHEMA_NAME,
} from './purchaseOrder.js';
import { TOPIC_DOCUMENT, TOPIC_SCHEMA } from './topic.js';
import { INVOICE_DOCUMENT, INVOICE_RULES, INVOICE_SCHEMA } from './invoice.js';

/**
 * Exactly three examples, each teaching something the others cannot.
 *
 * Three rather than a library: an example nobody can say the purpose of is a file that makes the
 * picker longer without making anyone more able to use the tool. Each of these is here for one
 * lesson, and the lessons are sequential.
 */
export interface Example {
  readonly id: string;
  readonly title: string;
  /** What this example teaches — shown on the card, so the choice is informed rather than a gamble. */
  readonly teaches: string;
  readonly documentName: string;
  readonly document: string;
  readonly schemaName: string | null;
  readonly schema: string | null;
  readonly rulesName: string | null;
  readonly rules: string | null;
}

const PURCHASE_ORDER_DOCUMENT = `<?xml version="1.0" encoding="UTF-8"?>
<purchaseOrder orderDate="2026-07-29">
  <shipTo country="GB">
    <name>Alice Smith</name>
    <street>123 Maple Street</street>
    <city>Cambridge</city>
    <postcode>CB1 2AB</postcode>
  </shipTo>
  <items>
    <item partNum="872-AA">
      <productName>Lawnmower</productName>
      <quantity>1</quantity>
      <price>148.95</price>
      <comment>Confirm this is electric</comment>
    </item>
    <item partNum="926-AA">
      <productName>Baby Monitor</productName>
      <quantity>2</quantity>
      <price>39.98</price>
    </item>
  </items>
</purchaseOrder>
`;

export const EXAMPLES: readonly Example[] = [
  {
    id: 'purchase-order',
    title: 'Purchase order',
    teaches: 'The core loop: one namespace, a handful of types, and a schema that guides every edit.',
    documentName: 'purchase-order.xml',
    document: PURCHASE_ORDER_DOCUMENT,
    schemaName: EXAMPLE_SCHEMA_NAME,
    schema: EXAMPLE_SCHEMA,
    rulesName: EXAMPLE_RULES_NAME,
    rules: EXAMPLE_RULES,
  },
  {
    id: 'topic',
    title: 'Technical topic',
    teaches:
      'Prefixes and mixed content: two namespaces in one document, and paragraphs with markup inside them.',
    documentName: 'topic.xml',
    document: TOPIC_DOCUMENT,
    schemaName: 'topic.xsd',
    schema: TOPIC_SCHEMA,
    rulesName: null,
    rules: null,
  },
  {
    id: 'invoice',
    title: 'Invoice with business rules',
    teaches:
      'Rules XSD cannot express. One rule fails the moment it opens, so the whole loop — error, explanation, fix, green — happens in under a minute.',
    documentName: 'invoice.xml',
    document: INVOICE_DOCUMENT,
    schemaName: 'invoice.xsd',
    schema: INVOICE_SCHEMA,
    rulesName: 'invoice.sch',
    rules: INVOICE_RULES,
  },
];

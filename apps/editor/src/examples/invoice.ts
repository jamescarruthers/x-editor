/**
 * The example that fails on open, on purpose.
 *
 * Everything else in the onboarding set opens green, which is reassuring and teaches nothing. This
 * one opens with exactly one failing rule so the whole loop a beginner needs to trust — a problem
 * appears, it is explained in words, a fix is one click, the badge goes green — happens inside the
 * first minute rather than the first time they make a mistake under pressure.
 *
 * The failing rule is a business rule rather than a schema violation, because that is the case where
 * "why is this wrong?" is genuinely hard: the document is structurally perfect and still incorrect,
 * which is exactly what XSD cannot tell you and Schematron can.
 */
export const INVOICE_SCHEMA = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">

  <xs:element name="invoice" type="Invoice">
    <xs:annotation>
      <xs:documentation>A bill for goods or services, with its lines and totals.</xs:documentation>
    </xs:annotation>
  </xs:element>

  <xs:complexType name="Invoice">
    <xs:sequence>
      <xs:element name="issued" type="xs:date"/>
      <xs:element name="due" type="xs:date"/>
      <xs:element name="currency" type="Currency"/>
      <xs:element name="line" type="Line" maxOccurs="unbounded"/>
      <xs:element name="total" type="Money">
        <xs:annotation>
          <xs:documentation>The sum of every line. XSD cannot check this; the rules can.</xs:documentation>
        </xs:annotation>
      </xs:element>
    </xs:sequence>
    <xs:attribute name="number" type="xs:string" use="required"/>
  </xs:complexType>

  <xs:complexType name="Line">
    <xs:sequence>
      <xs:element name="description" type="xs:string"/>
      <xs:element name="quantity" type="xs:positiveInteger"/>
      <xs:element name="amount" type="Money"/>
    </xs:sequence>
  </xs:complexType>

  <xs:simpleType name="Money">
    <xs:restriction base="xs:decimal">
      <xs:minInclusive value="0"/>
      <xs:fractionDigits value="2"/>
    </xs:restriction>
  </xs:simpleType>

  <xs:simpleType name="Currency">
    <xs:annotation>
      <xs:documentation>A three-letter ISO 4217 code.</xs:documentation>
    </xs:annotation>
    <xs:restriction base="xs:string">
      <xs:pattern value="[A-Z]{3}"/>
    </xs:restriction>
  </xs:simpleType>

</xs:schema>
`;

export const INVOICE_RULES = `<?xml version="1.0" encoding="UTF-8"?>
<sch:schema xmlns:sch="http://purl.oclc.org/dsdl/schematron" queryBinding="xslt2">
  <sch:title>Invoice business rules</sch:title>

  <sch:pattern id="totals">
    <sch:rule context="invoice">
      <sch:assert test="total = sum(line/amount)" diagnostics="total-help">
        The total is <sch:value-of select="total"/>, but the lines add up to
        <sch:value-of select="sum(line/amount)"/>.
      </sch:assert>
    </sch:rule>
  </sch:pattern>

  <sch:pattern id="dates">
    <sch:rule context="invoice">
      <sch:assert test="due >= issued">
        An invoice cannot fall due before it was issued.
      </sch:assert>
      <sch:report test="days-from-duration(xs:date(due) - xs:date(issued)) > 90" role="warning">
        This invoice allows <sch:value-of select="days-from-duration(xs:date(due) - xs:date(issued))"/>
        days to pay, which is unusually long.
      </sch:report>
    </sch:rule>
  </sch:pattern>

  <sch:diagnostics>
    <sch:diagnostic id="total-help">
      Either correct the total, or check whether a line is missing. The lines are the source of
      truth on most invoices.
    </sch:diagnostic>
  </sch:diagnostics>
</sch:schema>
`;

/**
 * Structurally perfect, and wrong.
 *
 * The total is 120.00; the lines add up to 140.00. Nothing in the XSD can catch that — which is the
 * entire point of shipping this document rather than a valid one.
 */
export const INVOICE_DOCUMENT = `<?xml version="1.0" encoding="UTF-8"?>
<invoice number="INV-2026-0043">
  <issued>2026-07-01</issued>
  <due>2026-07-31</due>
  <currency>GBP</currency>
  <line>
    <description>Design work</description>
    <quantity>2</quantity>
    <amount>80.00</amount>
  </line>
  <line>
    <description>Hosting, one year</description>
    <quantity>1</quantity>
    <amount>60.00</amount>
  </line>
  <total>120.00</total>
</invoice>
`;

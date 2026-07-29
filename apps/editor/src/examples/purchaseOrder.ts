/**
 * The example schema, matching the document the editor opens with.
 *
 * Its job is to make the guidance engine reachable in one click for someone who has arrived without
 * an `.xsd` of their own. It is deliberately ordinary — no namespace, unqualified locals, a couple
 * of enumerations and a pattern — because that is what a hand-written internal schema looks like,
 * and that is the schema a beginner is most likely to be handed.
 *
 * It carries `xs:documentation` on some declarations and not others, so both halves of `describe`
 * are visible: authored text where the author wrote it, and generated text where they did not.
 */
export const EXAMPLE_SCHEMA_NAME = 'purchase-order.xsd';

export const EXAMPLE_SCHEMA = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">

  <xs:element name="purchaseOrder" type="PurchaseOrder">
    <xs:annotation>
      <xs:documentation>A single order placed with a supplier.</xs:documentation>
    </xs:annotation>
  </xs:element>

  <xs:complexType name="PurchaseOrder">
    <xs:sequence>
      <xs:element name="shipTo" type="Address"/>
      <xs:element name="billTo" type="Address" minOccurs="0"/>
      <xs:element name="comment" type="xs:string" minOccurs="0"/>
      <xs:element name="items" type="Items"/>
    </xs:sequence>
    <xs:attribute name="orderDate" type="xs:date" use="required">
      <xs:annotation>
        <xs:documentation>The date the order was placed.</xs:documentation>
      </xs:annotation>
    </xs:attribute>
    <xs:attribute name="status" type="OrderStatus"/>
  </xs:complexType>

  <xs:complexType name="Address">
    <xs:sequence>
      <xs:element name="name" type="xs:string"/>
      <xs:element name="street" type="xs:string" maxOccurs="3"/>
      <xs:element name="city" type="xs:string"/>
      <xs:element name="postcode" type="Postcode"/>
    </xs:sequence>
    <xs:attribute name="country" type="CountryCode" use="required"/>
  </xs:complexType>

  <xs:complexType name="Items">
    <xs:sequence>
      <xs:element name="item" type="Item" maxOccurs="unbounded"/>
    </xs:sequence>
  </xs:complexType>

  <xs:complexType name="Item">
    <xs:sequence>
      <xs:element name="productName" type="xs:string"/>
      <xs:element name="quantity" type="Quantity"/>
      <xs:element name="price" type="Price"/>
      <xs:element name="shipDate" type="xs:date" minOccurs="0"/>
      <xs:element name="comment" type="xs:string" minOccurs="0"/>
    </xs:sequence>
    <xs:attribute name="partNum" type="PartNumber" use="required"/>
  </xs:complexType>

  <xs:simpleType name="Quantity">
    <xs:restriction base="xs:positiveInteger">
      <xs:maxInclusive value="99"/>
    </xs:restriction>
  </xs:simpleType>

  <xs:simpleType name="Price">
    <xs:restriction base="xs:decimal">
      <xs:minInclusive value="0"/>
      <xs:fractionDigits value="2"/>
    </xs:restriction>
  </xs:simpleType>

  <xs:simpleType name="PartNumber">
    <xs:annotation>
      <xs:documentation>The supplier's catalogue number, three digits then two letters.</xs:documentation>
    </xs:annotation>
    <xs:restriction base="xs:string">
      <xs:pattern value="\\d{3}-[A-Z]{2}"/>
    </xs:restriction>
  </xs:simpleType>

  <xs:simpleType name="Postcode">
    <xs:restriction base="xs:string">
      <xs:pattern value="[A-Z]{1,2}\\d[A-Z\\d]? ?\\d[A-Z]{2}"/>
    </xs:restriction>
  </xs:simpleType>

  <xs:simpleType name="CountryCode">
    <xs:restriction base="xs:string">
      <xs:length value="2"/>
      <xs:pattern value="[A-Z]{2}"/>
    </xs:restriction>
  </xs:simpleType>

  <xs:simpleType name="OrderStatus">
    <xs:restriction base="xs:string">
      <xs:enumeration value="draft"/>
      <xs:enumeration value="placed"/>
      <xs:enumeration value="shipped"/>
      <xs:enumeration value="cancelled"/>
    </xs:restriction>
  </xs:simpleType>

</xs:schema>
`;

/**
 * The two-namespace, mixed-content example.
 *
 * Its job is the lesson the purchase order cannot teach: that a prefix is a local nickname for a
 * namespace and not part of an element's name, and that some elements hold text and markup at once.
 * Both are the things beginners get wrong first, and both are invisible in a single-namespace
 * document.
 *
 * Deliberately DITA-shaped without being DITA. The real vocabularies in this space — DocBook, DITA,
 * TEI, JATS — are far too large to bundle, but their *shape* is what the reader will meet, so the
 * example matches the shape and not the size.
 */
export const TOPIC_SCHEMA = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
           xmlns="urn:example:topic"
           xmlns:meta="urn:example:metadata"
           targetNamespace="urn:example:topic"
           elementFormDefault="qualified">

  <xs:import namespace="urn:example:metadata" schemaLocation="metadata.xsd"/>

  <xs:element name="topic" type="Topic">
    <xs:annotation>
      <xs:documentation>A single unit of technical documentation.</xs:documentation>
    </xs:annotation>
  </xs:element>

  <xs:complexType name="Topic">
    <xs:sequence>
      <xs:element name="title" type="xs:string"/>
      <xs:element ref="meta:audience" minOccurs="0"/>
      <xs:element name="body" type="Body"/>
    </xs:sequence>
    <xs:attribute name="id" type="xs:ID" use="required"/>
  </xs:complexType>

  <xs:complexType name="Body">
    <xs:sequence>
      <xs:element name="p" type="Paragraph" maxOccurs="unbounded"/>
    </xs:sequence>
  </xs:complexType>

  <xs:complexType name="Paragraph" mixed="true">
    <xs:annotation>
      <xs:documentation>A paragraph. Text with emphasis and code spans mixed into it.</xs:documentation>
    </xs:annotation>
    <xs:choice minOccurs="0" maxOccurs="unbounded">
      <xs:element name="emph" type="xs:string"/>
      <xs:element name="code" type="xs:string"/>
    </xs:choice>
  </xs:complexType>

</xs:schema>
`;

/**
 * The imported metadata schema.
 *
 * A second file, because "this schema is in more than one document" is the other half of the lesson
 * and cannot be shown by a schema that imports nothing.
 */
export const TOPIC_METADATA_SCHEMA = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
           targetNamespace="urn:example:metadata"
           elementFormDefault="qualified">

  <xs:element name="audience">
    <xs:annotation>
      <xs:documentation>Who this topic is written for.</xs:documentation>
    </xs:annotation>
    <xs:simpleType>
      <xs:restriction base="xs:string">
        <xs:enumeration value="beginner"/>
        <xs:enumeration value="intermediate"/>
        <xs:enumeration value="expert"/>
      </xs:restriction>
    </xs:simpleType>
  </xs:element>

</xs:schema>
`;

export const TOPIC_DOCUMENT = `<?xml version="1.0" encoding="UTF-8"?>
<topic xmlns="urn:example:topic" xmlns:m="urn:example:metadata" id="attaching-a-schema">
  <title>Attaching a schema</title>
  <m:audience>beginner</m:audience>
  <body>
    <p>A schema tells the editor what belongs where. Until one is attached the
      <code>Insert</code> palette has nothing to offer, because <emph>anything</emph> is allowed.</p>
    <p>The prefix <code>m:</code> above is a local nickname. The element's real name is
      <code>audience</code> in <code>urn:example:metadata</code> — rename the prefix and the
      document means exactly the same thing.</p>
  </body>
</topic>
`;

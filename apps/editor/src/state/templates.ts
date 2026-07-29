/**
 * Starting points for a file made from scratch.
 *
 * A blank file is a worse starting point than it looks: an empty `.xsd` is not a schema, it is a
 * parse error, and the editor has nothing to say about it until enough of one exists to compile.
 * So each template is the smallest thing of its kind that actually works — it compiles, it says
 * something, and every part of it is meant to be replaced.
 *
 * They are deliberately tiny. A template with six types in it is a template people delete rather
 * than edit, and deleting is the one operation the tree is already good at.
 */

export const NEW_XML = `<?xml version="1.0" encoding="UTF-8"?>
<root/>
`;

/**
 * A schema with exactly one element, one type, and one of each thing worth seeing.
 *
 * `elementFormDefault="qualified"` because the alternative is the single most confusing default in
 * XSD — an unqualified local in a namespaced schema produces documents where half the elements are
 * in the namespace and half are not, and nobody chooses that on purpose.
 */
export const NEW_XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
           elementFormDefault="qualified">

  <xs:element name="root" type="Root">
    <xs:annotation>
      <xs:documentation>Replace this with a sentence about what the document is for. It is what
      people see in the Insert palette when they use this schema.</xs:documentation>
    </xs:annotation>
  </xs:element>

  <xs:complexType name="Root">
    <xs:sequence>
      <xs:element name="name" type="xs:string"/>
    </xs:sequence>
  </xs:complexType>

</xs:schema>
`;

/**
 * One pattern, one rule, one assert — the smallest Schematron that fires on something.
 *
 * The context is `/*` so the rule matches whatever document root it is pointed at, rather than
 * silently matching nothing and looking broken. A new rule that reports "0 nodes matched" is
 * indistinguishable from one that is wrong.
 */
export const NEW_SCH = `<?xml version="1.0" encoding="UTF-8"?>
<sch:schema xmlns:sch="http://purl.oclc.org/dsdl/schematron" queryBinding="xslt2">
  <sch:title>Business rules</sch:title>

  <sch:pattern id="example">
    <sch:rule context="/*">
      <sch:assert test="true()">
        Replace this test with something that should be true, and this message with what to do
        when it is not.
      </sch:assert>
    </sch:rule>
  </sch:pattern>
</sch:schema>
`;

import { describe, expect, it } from 'vitest';
import { XmlDocument, setNamespaceDeclaration } from '../src/index.js';

describe('setNamespaceDeclaration round-trip', () => {
  it('serializes a declaration added to an existing element', () => {
    const doc = XmlDocument.parse('<order><payment/></order>');
    const root = doc.documentElement()!;
    doc.run(setNamespaceDeclaration(doc, root, 'xsi', 'http://www.w3.org/2001/XMLSchema-instance'));
    console.log('SERIALIZED:', doc.serialize());
    expect(doc.serialize()).toContain('xmlns:xsi=');
  });
});

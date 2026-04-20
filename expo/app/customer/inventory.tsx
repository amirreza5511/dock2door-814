import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Modal, Alert, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Package, Plus, CheckCircle, ChevronRight, Archive, MinusCircle, PlusCircle } from 'lucide-react-native';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

interface Product {
  id: string;
  company_id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

interface Variant {
  id: string;
  product_id: string;
  sku: string;
  barcode: string | null;
  name: string;
}

export default function CustomerInventory() {
  const insets = useSafeAreaInsets();
  const utils = trpc.useUtils();
  const productsQuery = trpc.inventory.listProducts.useQuery();
  const createProduct = trpc.inventory.createProduct.useMutation({
    onSuccess: async () => { await utils.inventory.listProducts.invalidate(); },
  });
  const archiveProduct = trpc.inventory.archiveProduct.useMutation({
    onSuccess: async () => { await utils.inventory.listProducts.invalidate(); },
  });
  const upsertVariant = trpc.inventory.upsertVariant.useMutation();

  const [newProductModal, setNewProductModal] = useState<boolean>(false);
  const [newName, setNewName] = useState<string>('');
  const [newDesc, setNewDesc] = useState<string>('');

  const [selected, setSelected] = useState<Product | null>(null);
  const [detailModal, setDetailModal] = useState<boolean>(false);
  const [variantModal, setVariantModal] = useState<boolean>(false);
  const [variantSku, setVariantSku] = useState<string>('');
  const [variantBarcode, setVariantBarcode] = useState<string>('');
  const [variantName, setVariantName] = useState<string>('');

  const products = useMemo<Product[]>(() => (productsQuery.data ?? []) as Product[], [productsQuery.data]);

  const variantsQuery = trpc.inventory.listVariants.useQuery(
    { productId: selected?.id ?? '' },
    { enabled: Boolean(selected?.id) && detailModal },
  );
  const variants = useMemo<Variant[]>(() => (variantsQuery.data ?? []) as Variant[], [variantsQuery.data]);

  const handleCreateProduct = async () => {
    if (!newName.trim()) {
      Alert.alert('Missing name', 'Please enter a product name.');
      return;
    }
    try {
      await createProduct.mutateAsync({ name: newName.trim(), description: newDesc.trim() });
      setNewName(''); setNewDesc(''); setNewProductModal(false);
    } catch (error) {
      Alert.alert('Unable to create product', error instanceof Error ? error.message : 'Unknown error');
    }
  };

  const handleArchive = (p: Product) => {
    Alert.alert('Archive product', `Archive "${p.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Archive',
        style: 'destructive',
        onPress: async () => {
          try {
            await archiveProduct.mutateAsync({ id: p.id });
            if (selected?.id === p.id) {
              setDetailModal(false);
              setSelected(null);
            }
          } catch (error) {
            Alert.alert('Unable to archive', error instanceof Error ? error.message : 'Unknown error');
          }
        },
      },
    ]);
  };

  const handleAddVariant = async () => {
    if (!selected) return;
    if (!variantSku.trim()) {
      Alert.alert('Missing SKU', 'Please enter a SKU.');
      return;
    }
    try {
      await upsertVariant.mutateAsync({
        productId: selected.id,
        sku: variantSku.trim(),
        barcode: variantBarcode.trim() || null,
        name: variantName.trim(),
      });
      setVariantSku(''); setVariantBarcode(''); setVariantName('');
      setVariantModal(false);
      await utils.inventory.listVariants.invalidate({ productId: selected.id });
    } catch (error) {
      Alert.alert('Unable to add variant', error instanceof Error ? error.message : 'Unknown error');
    }
  };

  if (productsQuery.isLoading) {
    return (
      <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}>
        <ScreenFeedback state="loading" title="Loading inventory" />
      </View>
    );
  }

  if (productsQuery.isError) {
    return (
      <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}>
        <ScreenFeedback state="error" title="Unable to load inventory" description={productsQuery.error?.message} onRetry={() => void productsQuery.refetch()} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View>
          <Text style={styles.title}>Inventory</Text>
          <Text style={styles.sub}>{products.length} product{products.length === 1 ? '' : 's'}</Text>
        </View>
        <TouchableOpacity onPress={() => setNewProductModal(true)} style={styles.addBtn} testID="inventory-add-product">
          <Plus size={18} color={C.white} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        {products.length === 0 ? (
          <EmptyState icon={Package} title="No products yet" description="Add your first product to start managing SKUs and stock." />
        ) : (
          products.map((p) => (
            <TouchableOpacity key={p.id} onPress={() => { setSelected(p); setDetailModal(true); }} activeOpacity={0.85}>
              <Card style={styles.productCard}>
                <View style={styles.productRow}>
                  <View style={[styles.iconWrap, { backgroundColor: C.blueDim }]}>
                    <Archive size={18} color={C.blue} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.productName}>{p.name}</Text>
                    {p.description ? <Text style={styles.productDesc} numberOfLines={2}>{p.description}</Text> : null}
                  </View>
                  <ChevronRight size={18} color={C.textMuted} />
                </View>
              </Card>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      {/* Create product modal */}
      <Modal visible={newProductModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setNewProductModal(false)}>
        <View style={[styles.modal, { paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHandle} />
          <ScrollView contentContainerStyle={styles.modalBody} showsVerticalScrollIndicator={false}>
            <Text style={styles.modalTitle}>New Product</Text>
            <View style={styles.formGap}>
              <Input label="Name *" value={newName} onChangeText={setNewName} placeholder="Blue Widgets" testID="product-name" />
              <Input label="Description" value={newDesc} onChangeText={setNewDesc} multiline numberOfLines={3} placeholder="Optional description" />
              <Button label="Create Product" onPress={handleCreateProduct} loading={createProduct.isPending} fullWidth size="lg" icon={<CheckCircle size={16} color={C.white} />} />
              <Button label="Cancel" onPress={() => setNewProductModal(false)} variant="ghost" fullWidth />
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Product detail modal */}
      <Modal visible={detailModal && !!selected} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setDetailModal(false)}>
        <View style={[styles.modal, { paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHandle} />
          {selected ? (
            <ScrollView contentContainerStyle={styles.modalBody} showsVerticalScrollIndicator={false}>
              <Text style={styles.modalTitle}>{selected.name}</Text>
              {selected.description ? <Text style={styles.productDesc}>{selected.description}</Text> : null}

              <View style={styles.variantHeader}>
                <Text style={styles.sectionTitle}>Variants / SKUs</Text>
                <TouchableOpacity onPress={() => setVariantModal(true)} style={styles.addSmallBtn}>
                  <Plus size={14} color={C.accent} />
                  <Text style={styles.addSmallLabel}>Add SKU</Text>
                </TouchableOpacity>
              </View>

              {variantsQuery.isLoading ? (
                <ScreenFeedback state="loading" title="Loading SKUs" />
              ) : variants.length === 0 ? (
                <Card><Text style={styles.emptyText}>No SKUs yet. Add one to track stock.</Text></Card>
              ) : (
                variants.map((v) => (
                  <Card key={v.id} style={styles.variantCard}>
                    <View style={styles.variantRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.variantSku}>{v.sku}</Text>
                        {v.name ? <Text style={styles.variantName}>{v.name}</Text> : null}
                        {v.barcode ? <Text style={styles.variantMeta}>Barcode {v.barcode}</Text> : null}
                      </View>
                    </View>
                  </Card>
                ))
              )}

              <View style={{ height: 16 }} />
              <Button label="Archive Product" onPress={() => handleArchive(selected)} variant="danger" fullWidth icon={<MinusCircle size={15} color={C.red} />} />
              <Button label="Close" onPress={() => setDetailModal(false)} variant="ghost" fullWidth />
            </ScrollView>
          ) : null}
        </View>
      </Modal>

      {/* Add variant modal */}
      <Modal visible={variantModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setVariantModal(false)}>
        <View style={[styles.modal, { paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHandle} />
          <ScrollView contentContainerStyle={styles.modalBody} showsVerticalScrollIndicator={false}>
            <Text style={styles.modalTitle}>New SKU</Text>
            <View style={styles.formGap}>
              <Input label="SKU *" value={variantSku} onChangeText={setVariantSku} placeholder="SKU-001" autoCapitalize="characters" testID="variant-sku" />
              <Input label="Variant Name" value={variantName} onChangeText={setVariantName} placeholder="Large / Blue" />
              <Input label="Barcode" value={variantBarcode} onChangeText={setVariantBarcode} placeholder="UPC / EAN" />
              <Button label="Add SKU" onPress={handleAddVariant} loading={upsertVariant.isPending} fullWidth size="lg" icon={<PlusCircle size={16} color={C.white} />} />
              <Button label="Cancel" onPress={() => setVariantModal(false)} variant="ghost" fullWidth />
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { justifyContent: 'center', padding: 20 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 16, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  title: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  sub: { fontSize: 13, color: C.textSecondary, marginTop: 2 },
  addBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, gap: 10 },
  productCard: { padding: 14 },
  productRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  productName: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  productDesc: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  modal: { flex: 1, backgroundColor: C.bg },
  modalHandle: { width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginTop: 10 },
  modalBody: { padding: 20, gap: 14 },
  modalTitle: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  formGap: { gap: 14 },
  sectionTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  variantHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, marginBottom: 8 },
  addSmallBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.accentDim, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  addSmallLabel: { fontSize: 12, color: C.accent, fontWeight: '700' as const },
  variantCard: { padding: 12, marginBottom: 8 },
  variantRow: { flexDirection: 'row', alignItems: 'center' },
  variantSku: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  variantName: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  variantMeta: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  emptyText: { fontSize: 13, color: C.textSecondary, textAlign: 'center', padding: 12 },
});

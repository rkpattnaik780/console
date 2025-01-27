import * as React from 'react';
import {
  Alert,
  AlertVariant,
  Checkbox,
  ExpandableSection,
  Form,
  FormSelect,
  FormSelectOption,
  SelectOption,
  Stack,
  StackItem,
  TextInput,
} from '@patternfly/react-core';
import { Trans, useTranslation } from 'react-i18next';
import { ModalBody, ModalComponentProps, ModalTitle } from '@console/internal/components/factory';
import {
  ExternalLink,
  FirehoseResult,
  HandlePromiseProps,
  withHandlePromise,
} from '@console/internal/components/utils';
import {
  NamespaceModel,
  PersistentVolumeClaimModel,
  StorageClassModel,
} from '@console/internal/models';
import {
  ConfigMapKind,
  PersistentVolumeClaimKind,
  StorageClassResourceKind,
} from '@console/internal/module/k8s';
import { getAnnotations, getName } from '@console/shared/src';
import { DEFAULT_SC_ANNOTATION } from '../../../constants/sc';
import {
  AccessMode,
  DataVolumeSourceType,
  DiskBus,
  DiskType,
  VolumeMode,
  VolumeType,
} from '../../../constants/vm/storage';
import { useShowErrorToggler } from '../../../hooks/use-show-error-toggler';
import { CombinedDisk } from '../../../k8s/wrapper/vm/combined-disk';
import { DataVolumeWrapper } from '../../../k8s/wrapper/vm/data-volume-wrapper';
import { DiskWrapper } from '../../../k8s/wrapper/vm/disk-wrapper';
import { PersistentVolumeClaimWrapper } from '../../../k8s/wrapper/vm/persistent-volume-claim-wrapper';
import { VolumeWrapper } from '../../../k8s/wrapper/vm/volume-wrapper';
import {
  getDefaultSCAccessModes,
  getDefaultSCVolumeMode,
  getDefaultStorageClass,
  isConfigMapContainsScModes,
} from '../../../selectors/config-map/sc-defaults';
import { getPvcStorageSize } from '../../../selectors/pvc/selectors';
import { UIStorageEditConfig } from '../../../types/ui/storage';
import { getLoadedData, isLoaded, prefixedID, resolveDataVolumeName } from '../../../utils';
import {
  DYNAMIC,
  getDialogUIError,
  getSequenceName,
  STORAGE_CLASS_SUPPORTED_RHV_LINK,
  STORAGE_CLASS_SUPPORTED_VMWARE_LINK,
  PREALLOCATION_DATA_VOLUME_LINK,
} from '../../../utils/strings';
import { isFieldDisabled } from '../../../utils/ui/edit-config';
import { isValidationError } from '../../../utils/validations/common';
import { TemplateValidations } from '../../../utils/validations/template/template-validations';
import { validateDisk } from '../../../utils/validations/vm';
import { ConfigMapDefaultModesAlert } from '../../Alerts/ConfigMapDefaultModesAlert';
import { PendingChangesAlert } from '../../Alerts/PendingChangesAlert';
import { VMImportProvider } from '../../create-vm-wizard/types';
import { FormPFSelect } from '../../form/form-pf-select';
import { FormRow } from '../../form/form-row';
import {
  asFormSelectValue,
  FormSelectPlaceholderOption,
} from '../../form/form-select-placeholder-option';
import { ContainerSourceHelp } from '../../form/helper/container-source-help';
import { URLSourceHelp } from '../../form/helper/url-source-help';
import { K8sResourceSelectRow } from '../../form/k8s-resource-select-row';
import { SizeUnitFormRow } from '../../form/size-unit-form-row';
import { BinaryUnit, stringValueUnitSplit } from '../../form/size-unit-utils';
import { ModalFooter } from '../modal/modal-footer';
import { StorageUISource } from './storage-ui-source';

import './disk-modal.scss';

export const DiskModal = withHandlePromise((props: DiskModalProps) => {
  const {
    showInitialValidation,
    storageClasses,
    usedPVCNames,
    persistentVolumeClaims,
    vmName,
    vmNamespace,
    namespace,
    namespaces,
    onNamespaceChanged,
    usedDiskNames,
    isTemplate = false,
    onSubmit,
    inProgress: _inProgress,
    isEditing,
    errorMessage,
    handlePromise,
    close,
    cancel,
    templateValidations,
    storageClassConfigMap: _storageClassConfigMap,
    editConfig,
    isVMRunning,
    importProvider,
    baseImageName,
  } = props;
  const { t } = useTranslation();
  const inProgress = _inProgress || !isLoaded(_storageClassConfigMap);
  const isDisabled = (fieldName: string, disabled?: boolean) =>
    inProgress || disabled || isFieldDisabled(editConfig, fieldName);

  const storageClassConfigMap = getLoadedData(_storageClassConfigMap);

  const asId = prefixedID.bind(null, 'disk');
  const disk = props.disk || new DiskWrapper();
  const volume = props.volume || new VolumeWrapper();
  const dataVolume = props.dataVolume || new DataVolumeWrapper();
  const tValidations = templateValidations || new TemplateValidations();

  const combinedDisk = new CombinedDisk({
    diskWrapper: disk,
    volumeWrapper: volume,
    dataVolumeWrapper: dataVolume,
    persistentVolumeClaimWrapper: props.persistentVolumeClaim,
    isNewPVC: !!props.persistentVolumeClaim,
  });
  const combinedDiskSize = combinedDisk.getSize();

  const [type, setType] = React.useState<DiskType>(disk.getType() || DiskType.DISK);

  const [source, setSource] = React.useState<StorageUISource>(
    combinedDisk.getInitialSource(isEditing),
  );

  const [url, setURL] = React.useState<string>(dataVolume.getURL());

  const [containerImage, setContainerImage] = React.useState<string>(
    volume.getType() === VolumeType.CONTAINER_DISK
      ? volume.getContainerImage()
      : dataVolume.getContainer() || '',
  );

  const [pvcName, setPVCName] = React.useState<string>(combinedDisk.getPVCNameBySource(source));

  const [name, setName] = React.useState<string>(
    disk.getName() || getSequenceName('disk', usedDiskNames),
  );

  const validAllowedBuses = tValidations.getAllowedBuses(
    isEditing ? DiskType.DISK : disk.getType(),
  );
  const recommendedBuses = tValidations.getRecommendedBuses(
    isEditing ? DiskType.DISK : disk.getType(),
  );
  const allowedBuses = [...validAllowedBuses].filter((b) => type.isBusSupported(b));

  const [bus, setBus] = React.useState<DiskBus>(
    disk.getDiskBus() ||
      (isEditing ? null : validAllowedBuses.has(DiskBus.VIRTIO) ? DiskBus.VIRTIO : allowedBuses[0]),
  );
  const [storageClassName, setStorageClassName] = React.useState<string>(
    combinedDisk.getStorageClassName() || '',
  );

  const [size, setSize] = React.useState<string>(
    combinedDiskSize ? `${combinedDiskSize.value}` : '',
  );
  const [unit, setUnit] = React.useState<string>(
    (combinedDiskSize && combinedDiskSize.unit) || BinaryUnit.Gi,
  );

  const [advancedDrawerIsOpen, setAdvancedDrawerIsOpen] = React.useState(false);

  const [accessMode, setAccessMode] = React.useState<AccessMode>(
    (isEditing && (combinedDisk.getAccessModes() || [])[0]) || null,
  );

  const [volumeMode, setVolumeMode] = React.useState<VolumeMode>(
    (isEditing && combinedDisk.getVolumeMode()) || null,
  );

  const [enablePreallocation, setEnablePreallocation] = React.useState<boolean>(
    dataVolume.getPreallocation(),
  );

  React.useEffect(() => {
    if (source.requiresPVC()) {
      const pvcNameDataVolume = dataVolume.getPersistentVolumeClaimName();
      const pvcNamespaceDataVolume = dataVolume.getPersistentVolumeClaimNamespace();
      const pvc = persistentVolumeClaims?.data.find(
        ({ metadata }) =>
          metadata?.name === pvcNameDataVolume && metadata?.namespace === pvcNamespaceDataVolume,
      );
      setVolumeMode((value) => VolumeMode.fromString(pvc?.spec?.volumeMode) || value);
    }
  }, [dataVolume, persistentVolumeClaims, source]);

  const [defaultAccessMode, defaultVolumeMode, isScModesKnown] = React.useMemo(() => {
    return [
      getDefaultSCAccessModes(storageClassConfigMap, storageClassName)?.[0],
      getDefaultSCVolumeMode(storageClassConfigMap, storageClassName),
      isConfigMapContainsScModes(storageClassConfigMap, storageClassName),
    ];
  }, [storageClassConfigMap, storageClassName]);

  React.useEffect(() => {
    if (!isEditing) {
      let defaultStorageClass = null;

      if (!storageClassName) {
        defaultStorageClass = getDefaultStorageClass(getLoadedData(storageClasses, []));

        if (defaultStorageClass) {
          setStorageClassName(getName(defaultStorageClass) || '');
        }
      }

      if (defaultAccessMode) {
        setVolumeMode(defaultVolumeMode);
      }

      if (defaultVolumeMode) {
        setAccessMode(defaultAccessMode);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultAccessMode, defaultVolumeMode, storageClassName, storageClasses]);

  const resultDisk = DiskWrapper.initializeFromSimpleData({
    name,
    bus,
    type,
  });

  // We can generate a random name every time, because this modal should not operate on disks with live datavolumes
  const resultDataVolumeName = resolveDataVolumeName({
    diskName: name,
    vmLikeEntityName: vmName,
    isTemplate,
  });

  const resultVolume = VolumeWrapper.initializeFromSimpleData({
    name,
    type: source.getVolumeType(),
    typeData: {
      name: resultDataVolumeName,
      claimName: pvcName,
      image: containerImage,
    },
  });

  let resultDataVolume;
  if (source.requiresDatavolume()) {
    resultDataVolume = new DataVolumeWrapper()
      .init({
        name: resultDataVolumeName,
        unit,
        size,
        storageClassName: storageClassName || null, // || null is to enable merging
      })
      .setType(source.getDataVolumeSourceType(), {
        name: pvcName,
        namespace,
        url:
          source.getDataVolumeSourceType() === DataVolumeSourceType.REGISTRY ? containerImage : url,
      })
      .setVolumeMode(volumeMode || null)
      .setAccessModes(accessMode ? [accessMode] : null)
      .setPreallocationDisk(enablePreallocation);
  }

  let resultPersistentVolumeClaim;
  if (source.requiresNewPVC()) {
    resultPersistentVolumeClaim = new PersistentVolumeClaimWrapper()
      .init({
        name,
        storageClassName: storageClassName || null, // || null is to enable merging
        size,
        unit,
      })
      .setVolumeMode(volumeMode || null)
      .setAccessModes(accessMode ? [accessMode] : null);
  }

  const {
    validations: {
      name: nameValidation,
      size: sizeValidation,
      container: containerValidation,
      pvc: pvcValidation,
      diskInterface: busValidation,
      url: urlValidation,
      type: typeValidation,
    },
    isValid,
    hasAllRequiredFilled,
  } = validateDisk(resultDisk, resultVolume, resultDataVolume, resultPersistentVolumeClaim, {
    usedDiskNames,
    usedPVCNames,
    templateValidations,
  });

  const [showUIError, setShowUIError] = useShowErrorToggler(
    !!showInitialValidation,
    isValid,
    isValid,
  );

  const submit = (e) => {
    e.preventDefault();

    if (isValid) {
      handlePromise(
        onSubmit(resultDisk, resultVolume, resultDataVolume, resultPersistentVolumeClaim),
        close,
      );
    } else {
      setShowUIError(true);
    }
  };

  const onNameChanged = React.useCallback(
    (v) => {
      if (source.requiresNewPVC()) {
        setPVCName(v);
      }
      setName(v);
    },
    [setName, setPVCName, source],
  );

  const onStorageClassNameChanged = (newStorageClassName) => {
    // eslint-disable-next-line eqeqeq
    if (newStorageClassName != storageClassName) {
      setStorageClassName(newStorageClassName);
      const newAccessMode = getDefaultSCAccessModes(storageClassConfigMap, newStorageClassName)[0];
      const newVolumeMode = getDefaultSCVolumeMode(storageClassConfigMap, newStorageClassName);
      if (newAccessMode !== accessMode) {
        setAccessMode(newAccessMode);
      }
      if (newVolumeMode !== volumeMode) {
        setVolumeMode(newVolumeMode);
      }
    }
  };

  const onSourceChanged = (e, uiSource) => {
    setSize('');
    setUnit('Gi');
    setURL('');
    setPVCName('');
    setContainerImage('');
    onStorageClassNameChanged('');
    onNamespaceChanged(vmNamespace);
    setSource(StorageUISource.fromString(uiSource));
  };

  const onPVCChanged = (newPVCName) => {
    setPVCName(newPVCName);
    if (source === StorageUISource.ATTACH_CLONED_DISK) {
      const newSizeBundle = getPvcStorageSize(
        getLoadedData(persistentVolumeClaims).find((p) => getName(p) === newPVCName),
      );
      const [newSize, newUnit] = stringValueUnitSplit(newSizeBundle);
      setSize(newSize);
      setUnit(newUnit);
    }
  };

  const onToggleAdvancedDrawer = () => {
    setAdvancedDrawerIsOpen(!advancedDrawerIsOpen);
  };

  const onTypeChanged = (diskType) => {
    const newType = DiskType.fromString(diskType);
    setType(newType);
    if (newType === DiskType.CDROM && source === StorageUISource.BLANK) {
      onSourceChanged(null, StorageUISource.URL.getValue());
    }
    if (newType === DiskType.CDROM && bus === DiskBus.VIRTIO) {
      setBus(DiskBus.SATA);
    }
  };

  const onTogglePreallocation = () => setEnablePreallocation(!enablePreallocation);

  const isStorageClassDataLoading = !isLoaded(storageClasses) || !isLoaded(_storageClassConfigMap);

  return (
    <div className="modal-content">
      <ModalTitle>
        {isEditing ? t('kubevirt-plugin~Edit') : t('kubevirt-plugin~Add')}{' '}
        {t('kubevirt-plugin~{{type}}', { type: type.toString() })}
      </ModalTitle>
      <ModalBody>
        {isVMRunning && (
          <PendingChangesAlert
            warningMsg={t(
              'kubevirt-plugin~The changes you are making require this virtual machine to be updated. Restart this VM to apply these changes.',
            )}
          />
        )}
        <Form>
          <FormRow title={t('kubevirt-plugin~Source')} fieldId={asId('source')} isRequired>
            <FormPFSelect
              menuAppendTo={() => document.body}
              isDisabled={isDisabled('source', !source.canBeChangedToThisSource(type))}
              selections={asFormSelectValue(t(source.toString()))}
              onSelect={onSourceChanged}
              toggleId={asId('select-source')}
            >
              {StorageUISource.getAll()
                .filter(
                  (storageUISource) =>
                    storageUISource.canBeChangedToThisSource(type) ||
                    !source.canBeChangedToThisSource(type),
                )
                .sort((a, b) => a.getOrder() - b.getOrder())
                .map((uiType) => {
                  return (
                    <SelectOption
                      key={uiType.getValue()}
                      value={uiType.getValue()}
                      description={t(uiType.getDescriptionKey())}
                    >
                      {t(uiType.toString())}
                    </SelectOption>
                  );
                })}
            </FormPFSelect>
          </FormRow>
          {source.requiresURL() && (
            <FormRow
              title={t('kubevirt-plugin~URL')}
              fieldId={asId('url')}
              isRequired
              validation={urlValidation}
            >
              <TextInput
                validated={!isValidationError(urlValidation) ? 'default' : 'error'}
                key="url"
                isDisabled={isDisabled('url')}
                isRequired
                id={asId('url')}
                value={url}
                onChange={setURL}
              />
              <URLSourceHelp baseImageName={baseImageName} />
            </FormRow>
          )}
          {source.requiresContainerImage() && (
            <FormRow
              title={t('kubevirt-plugin~Container')}
              fieldId={asId('container')}
              isRequired
              validation={containerValidation}
            >
              <TextInput
                validated={!isValidationError(containerValidation) ? 'default' : 'error'}
                key="container"
                isDisabled={isDisabled('container')}
                isRequired
                id={asId('container')}
                value={containerImage}
                onChange={setContainerImage}
              />
              <ContainerSourceHelp />
            </FormRow>
          )}
          {source.requiresNamespace() && (
            <K8sResourceSelectRow
              key="pvc-namespace"
              id={asId('pvc-namespace')}
              isDisabled={isDisabled('pvcNamespace')}
              name={namespace}
              data={namespaces}
              model={NamespaceModel}
              title={`PVC ${NamespaceModel.label}`}
              onChange={(ns) => {
                setPVCName('');
                onNamespaceChanged(ns);
              }}
            />
          )}
          {source.requiresPVC() && (
            <K8sResourceSelectRow
              key="pvc-select"
              id={asId('pvc')}
              isDisabled={isDisabled('pvc', !namespace)}
              isRequired
              name={pvcName}
              validation={pvcValidation}
              data={persistentVolumeClaims}
              model={PersistentVolumeClaimModel}
              hasPlaceholder
              isPlaceholderDisabled
              onChange={onPVCChanged}
              filter={(p) => !(usedPVCNames && usedPVCNames.has(getName(p)))}
            />
          )}
          <FormRow
            title={t('kubevirt-plugin~Name')}
            fieldId={asId('name')}
            isRequired
            isLoading={!usedDiskNames}
            validation={nameValidation}
          >
            <TextInput
              validated={!isValidationError(nameValidation) ? 'default' : 'error'}
              isDisabled={isDisabled('name', !usedDiskNames)}
              isRequired
              id={asId('name')}
              value={name}
              onChange={onNameChanged}
            />
          </FormRow>

          {source.requiresSize() && (
            <SizeUnitFormRow
              title={t('kubevirt-plugin~Size')}
              key="size-row"
              id={asId('size-row')}
              size={size}
              unit={unit as BinaryUnit}
              units={source.getAllowedUnits()}
              validation={sizeValidation}
              isDisabled={isDisabled(
                'size',
                !source.isSizeEditingSupported(combinedDiskSize?.value),
              )}
              isRequired
              onSizeChanged={
                source.isSizeEditingSupported(combinedDiskSize?.value) ? setSize : undefined
              }
              onUnitChanged={
                source.isSizeEditingSupported(combinedDiskSize?.value) ? setUnit : undefined
              }
            />
          )}
          {!source.requiresSize() && source.hasDynamicSize() && (
            <FormRow title={t('kubevirt-plugin~Size')} fieldId={asId('dynamic-size-row')}>
              <TextInput
                key="dynamic-size-row"
                isDisabled
                id={asId('dynamic-size-row')}
                value={DYNAMIC}
              />
            </FormRow>
          )}
          <FormRow
            title={t('kubevirt-plugin~Type')}
            fieldId={asId('type')}
            validation={typeValidation}
            isRequired
          >
            <FormSelect
              onChange={onTypeChanged}
              value={asFormSelectValue(type.getValue())}
              id={asId('type')}
              isDisabled={isDisabled('type')}
            >
              <FormSelectPlaceholderOption
                isDisabled
                placeholder={t('kubevirt-plugin~--- Select Type ---')}
              />
              {DiskType.getAll()
                .filter((dtype) => !dtype.isDeprecated() || dtype === type)
                .map((dt) => (
                  <FormSelectOption
                    key={dt.getValue()}
                    value={dt.getValue()}
                    label={dt.toString()}
                  />
                ))}
            </FormSelect>
          </FormRow>
          <FormRow
            title={t('kubevirt-plugin~Interface')}
            fieldId={asId('interface')}
            isRequired
            validation={busValidation}
          >
            <FormPFSelect
              menuAppendTo={() => document.body}
              isDisabled={isDisabled('interface')}
              selections={asFormSelectValue(t(bus.toString()))}
              onSelect={React.useCallback(
                (e, diskBus) => setBus(DiskBus.fromString(diskBus.toString())),
                [setBus],
              )}
              toggleId={asId('select-interface')}
            >
              {allowedBuses.map((b) => (
                <SelectOption
                  key={b.getValue()}
                  value={b.getValue()}
                  description={t(b.getDescriptionKey())}
                >
                  {t(b.toString())}
                  {recommendedBuses.size !== validAllowedBuses.size && recommendedBuses.has(b)
                    ? t('kubevirt-plugin~ --- Recommended ---')
                    : ''}
                </SelectOption>
              ))}
            </FormPFSelect>
          </FormRow>
          {source.requiresStorageClass() && (
            <Stack hasGutter>
              {importProvider && (
                <StackItem>
                  <Alert
                    variant={AlertVariant.warning}
                    isInline
                    title={t('kubevirt-plugin~Supported Storage classes')}
                  >
                    <ExternalLink
                      text={t('kubevirt-plugin~Supported Storage classes for selected provider')}
                      href={
                        importProvider === VMImportProvider.OVIRT
                          ? STORAGE_CLASS_SUPPORTED_VMWARE_LINK
                          : STORAGE_CLASS_SUPPORTED_RHV_LINK
                      }
                    />
                  </Alert>
                </StackItem>
              )}
              <StackItem>
                <K8sResourceSelectRow
                  title={t('kubevirt-plugin~Storage Class')}
                  key="storage-class"
                  id={asId('storage-class')}
                  isDisabled={isDisabled('storageClass') || isStorageClassDataLoading}
                  name={storageClassName}
                  data={storageClasses}
                  model={StorageClassModel}
                  hasPlaceholder
                  onChange={(sc) => onStorageClassNameChanged(sc || '')}
                  getResourceLabel={(sc) =>
                    getAnnotations(sc, {})[DEFAULT_SC_ANNOTATION] === 'true'
                      ? t('kubevirt-plugin~{{name}} (default)', { name: getName(sc) })
                      : getName(sc)
                  }
                />
              </StackItem>
              <StackItem>
                <Checkbox
                  id="cnv668"
                  description={
                    <Trans t={t} ns="kubevirt-plugin">
                      Refer to the{' '}
                      <ExternalLink
                        text={t('kubevirt-plugin~Documentation')}
                        href={PREALLOCATION_DATA_VOLUME_LINK}
                      />{' '}
                      or contact your system administrator for more information. Enabling
                      preallocation is available only for blank disk source.
                    </Trans>
                  }
                  isDisabled={!source.requiresBlankDisk()}
                  isChecked={enablePreallocation}
                  label={t('kubevirt-plugin~Enable preallocation')}
                  onChange={() => onTogglePreallocation()}
                />
              </StackItem>
            </Stack>
          )}
          {source.requiresVolumeModeOrAccessModes() && (
            <ExpandableSection
              toggleText={t('kubevirt-plugin~Advanced')}
              isExpanded={advancedDrawerIsOpen}
              onToggle={onToggleAdvancedDrawer}
              className="disk-advanced-drawer"
            >
              <Stack hasGutter>
                <StackItem>
                  {source.requiresVolumeMode() && (
                    <FormRow title={t('kubevirt-plugin~Volume Mode')} fieldId={asId('volume-mode')}>
                      <FormSelect
                        onChange={(vMode) => setVolumeMode(VolumeMode.fromString(vMode))}
                        value={asFormSelectValue(volumeMode?.getValue())}
                        id={asId('volume-mode')}
                        isDisabled={
                          isDisabled('volumeMode') ||
                          isStorageClassDataLoading ||
                          source.requiresPVC()
                        }
                      >
                        <FormSelectPlaceholderOption
                          isDisabled={inProgress}
                          placeholder={t('kubevirt-plugin~--- Select Volume Mode ---')}
                        />
                        {VolumeMode.getAll().map((v) => (
                          <FormSelectOption
                            key={v.getValue()}
                            value={v.getValue()}
                            label={v.toString().concat(
                              v.getValue() !== defaultVolumeMode.getValue() && isScModesKnown
                                ? t(
                                    'kubevirt-plugin~ - Not recommended for {{storageClassName}} storage class',
                                    {
                                      storageClassName,
                                    },
                                  )
                                : '',
                            )}
                          />
                        ))}
                      </FormSelect>
                      {source.requiresPVC() && (
                        <div className="pf-c-form__helper-text" aria-live="polite">
                          {t('kubevirt-plugin~Volume Mode is set by Source PVC')}
                        </div>
                      )}
                    </FormRow>
                  )}
                  {source.requiresAccessModes() && (
                    <FormRow
                      title={t('kubevirt-plugin~Access Mode')}
                      fieldId={asId('access-mode')}
                      className="disk-access-mode"
                    >
                      <FormSelect
                        onChange={(aMode) => setAccessMode(AccessMode.fromString(aMode))}
                        value={asFormSelectValue(accessMode?.getValue())}
                        id={asId('access-mode')}
                        isDisabled={isDisabled('accessMode') || isStorageClassDataLoading}
                      >
                        <FormSelectPlaceholderOption
                          isDisabled={inProgress}
                          placeholder={t('kubevirt-plugin~--- Select Access Mode ---')}
                        />
                        {AccessMode.getAll().map((a) => (
                          <FormSelectOption
                            key={a.getValue()}
                            value={a.getValue()}
                            label={a.toString().concat(
                              a.getValue() !== defaultAccessMode.getValue() && isScModesKnown
                                ? t(
                                    'kubevirt-plugin~ - Not recommended for {{storageClassName}} storage class',
                                    {
                                      storageClassName,
                                    },
                                  )
                                : '',
                            )}
                          />
                        ))}
                      </FormSelect>
                    </FormRow>
                  )}
                </StackItem>
                <StackItem>
                  <ConfigMapDefaultModesAlert isScModesKnown={isScModesKnown} />
                </StackItem>
              </Stack>
            </ExpandableSection>
          )}
        </Form>
      </ModalBody>
      <ModalFooter
        id="disk"
        submitButtonText={isEditing ? t('kubevirt-plugin~Save') : t('kubevirt-plugin~Add')}
        errorMessage={
          errorMessage || (showUIError ? getDialogUIError(hasAllRequiredFilled, t) : null)
        }
        isDisabled={inProgress}
        inProgress={inProgress}
        isSimpleError={showUIError}
        onSubmit={submit}
        onCancel={(e) => {
          e.stopPropagation();
          cancel();
        }}
      />
    </div>
  );
});

export type DiskModalProps = {
  disk?: DiskWrapper;
  showInitialValidation?: boolean;
  isTemplate?: boolean;
  isEditing?: boolean;
  volume?: VolumeWrapper;
  dataVolume?: DataVolumeWrapper;
  persistentVolumeClaim?: PersistentVolumeClaimWrapper;
  storageClassConfigMap?: FirehoseResult<ConfigMapKind>;
  onSubmit: (
    disk: DiskWrapper,
    volume: VolumeWrapper,
    dataVolume: DataVolumeWrapper,
    persistentVolumeClaim: PersistentVolumeClaimWrapper,
  ) => Promise<any>;
  namespaces?: FirehoseResult;
  storageClasses?: FirehoseResult<StorageClassResourceKind[]>;
  persistentVolumeClaims?: FirehoseResult<PersistentVolumeClaimKind[]>;
  vmName: string;
  vmNamespace: string;
  namespace: string;
  onNamespaceChanged: (namespace: string) => void;
  templateValidations?: TemplateValidations;
  usedDiskNames: Set<string>;
  usedPVCNames: Set<string>;
  editConfig?: UIStorageEditConfig;
  baseImageName?: string;
  isVMRunning?: boolean;
  importProvider?: VMImportProvider;
} & ModalComponentProps &
  HandlePromiseProps;

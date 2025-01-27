import * as React from 'react';
import {
  isTopologyDataModelFactory as isDynamicTopologyDataModelFactory,
  TopologyDataModelFactory as DynamicTopologyDataModelFactory,
} from '@console/dynamic-plugin-sdk';
import { LoadedExtension, useExtensions } from '@console/plugin-sdk/src';
import { isTopologyDataModelFactory, TopologyDataModelFactory } from '../extensions/topology';
import DataModelExtension from './DataModelExtension';
import { ModelContext, ExtensibleModel } from './ModelContext';
import TopologyDataRetriever from './TopologyDataRetriever';

interface DataModelProviderProps {
  namespace: string;
  children?: React.ReactNode;
}

export const getNamespacedDynamicModelFactories = (
  factories: LoadedExtension<DynamicTopologyDataModelFactory>[],
) =>
  factories.map(({ properties, ...ext }) => ({
    ...ext,
    properties: {
      ...properties,
      resources: (namespace: string) =>
        Object.assign(
          {},
          ...Object.entries(properties.resources).map(([k, v]) => ({
            [k]: { namespace, ...v },
          })),
        ),
    },
  }));

const DataModelProvider: React.FC<DataModelProviderProps> = ({ namespace, children }) => {
  const [model, setModel] = React.useState<ExtensibleModel>(new ExtensibleModel(namespace));

  React.useEffect(() => {
    setModel(new ExtensibleModel(namespace));
  }, [namespace]);

  const modelFactories = useExtensions<TopologyDataModelFactory>(isTopologyDataModelFactory);
  const dynamicModelFactories = useExtensions<DynamicTopologyDataModelFactory>(
    isDynamicTopologyDataModelFactory,
  );

  const namespacedDynamicFactories = React.useMemo(
    () => getNamespacedDynamicModelFactories(dynamicModelFactories),
    [dynamicModelFactories],
  );

  return (
    <ModelContext.Provider value={model}>
      {namespace && (
        <>
          {[...namespacedDynamicFactories, ...modelFactories].map((factory) => (
            <DataModelExtension key={factory.properties.id} dataModelFactory={factory.properties} />
          ))}
        </>
      )}
      {namespace && <TopologyDataRetriever />}
      {children}
    </ModelContext.Provider>
  );
};

export default DataModelProvider;
